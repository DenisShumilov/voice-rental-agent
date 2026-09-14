// Turns a confirmed draft into exactly one reservation row.
//
// Invariant: a reservation is written only when all four gates pass —
//   1. the draft is not already confirmed
//   2. the request is complete and currently available
//   3. the supplied token and version match the draft's current ones
//   4. inside a write transaction, availability still holds AND
//      UNIQUE(draft_id) accepts the insert
// Gate 4 lives in the database, so even a race cannot produce a duplicate.

import { randomUUID } from 'node:crypto'

import { getAvailability } from './availability'
import { today } from './clock'
import { getDb, isUniqueViolation } from './db'
import { getDraftById, type Draft } from './drafts'
import { logEvent } from './events'

export type ConfirmOutcome =
  | 'confirmed'
  | 'already_confirmed'
  | 'stale_confirmation'
  | 'not_available'
  | 'incomplete'
  | 'unknown_draft'

export type Reservation = {
  id: string
  itemId: string
  quantity: number
  startDate: string
  endDate: string
  draftId: string | null
  source: string
  createdAt: string
}

export type ConfirmResult = {
  outcome: ConfirmOutcome
  draft: Draft | null
  reservation: Reservation | null
  /** Units of this item still free across the booked dates. */
  remaining: number | null
}

export type ConfirmInput = {
  /** The conversation redeeming the token. It must own the draft. */
  sessionId: string
  draftId: string
  version: number
  confirmationToken: string
}

export async function confirmBooking(input: ConfirmInput): Promise<ConfirmResult> {
  const draft = await getDraftById(input.draftId)

  // A draft id is not a capability. One conversation may not confirm another's
  // request even if it somehow learned the id.
  if (!draft || draft.sessionId !== input.sessionId) {
    return { outcome: 'unknown_draft', draft: null, reservation: null, remaining: null }
  }

  // Gate 1. Saying "yes, confirm it" a second time must not write anything.
  if (draft.status === 'confirmed') {
    const reservation = draft.reservationId
      ? await getReservationById(draft.reservationId)
      : null

    await logEvent(draft.sessionId, 'booking_replayed', {
      draftId: draft.id,
      reservationId: draft.reservationId,
    })

    return {
      outcome: 'already_confirmed',
      draft,
      reservation,
      remaining: await remainingFor(draft),
    }
  }

  // Gate 2. Report why it cannot be booked before looking at the token, so the
  // agent can say something useful instead of "that confirmation expired".
  if (draft.status === 'incomplete') {
    await logEvent(draft.sessionId, 'booking_rejected', {
      draftId: draft.id,
      reason: 'incomplete',
    })
    return { outcome: 'incomplete', draft, reservation: null, remaining: null }
  }

  if (draft.status === 'unavailable') {
    await logEvent(draft.sessionId, 'booking_rejected', {
      draftId: draft.id,
      reason: 'not_available',
    })
    return {
      outcome: 'not_available',
      draft,
      reservation: null,
      remaining: await remainingFor(draft),
    }
  }

  // Gate 3. The token is bound to one version. Any correction rotated it.
  const tokenMatches =
    draft.confirmationToken !== null &&
    draft.confirmationToken === input.confirmationToken
  if (!tokenMatches || draft.version !== input.version) {
    await logEvent(draft.sessionId, 'booking_rejected', {
      draftId: draft.id,
      reason: 'stale_confirmation',
      currentVersion: draft.version,
      presentedVersion: input.version,
      tokenMatches,
    })
    return { outcome: 'stale_confirmation', draft, reservation: null, remaining: null }
  }

  // Gate 4. Re-check availability inside the transaction that writes the row.
  const itemId = draft.itemId as string
  const quantity = draft.quantity as number
  const startDate = draft.startDate as string
  const endDate = draft.endDate as string

  // A token stays valid until the draft changes, but the calendar moves on its
  // own. A request that was for today can be redeemed after midnight, so the
  // one rule that can drift is re-run here. Stock cannot drift the same way —
  // the transaction below re-checks it.
  if (startDate < today()) {
    await markUnavailable(draft)
    await logEvent(draft.sessionId, 'booking_rejected', {
      draftId: draft.id,
      reason: 'past_dates_at_commit',
      startDate,
    })
    return {
      outcome: 'not_available',
      draft: await getDraftById(draft.id),
      reservation: null,
      remaining: null,
    }
  }

  const reservation: Reservation = {
    id: randomUUID(),
    itemId,
    quantity,
    startDate,
    endDate,
    draftId: draft.id,
    source: 'voice',
    createdAt: new Date().toISOString(),
  }

  const transaction = await getDb().transaction('write')
  try {
    const availability = await getAvailability(itemId, startDate, endDate, {
      executor: transaction,
    })

    if (availability.available < quantity) {
      await transaction.rollback()
      await markUnavailable(draft)
      await logEvent(draft.sessionId, 'booking_rejected', {
        draftId: draft.id,
        reason: 'not_available_at_commit',
        available: availability.available,
      })
      return {
        outcome: 'not_available',
        draft: await getDraftById(draft.id),
        reservation: null,
        remaining: availability.available,
      }
    }

    await transaction.execute({
      sql: `INSERT INTO reservations
              (id, item_id, quantity, start_date, end_date, status, source, draft_id, created_at)
            VALUES (?, ?, ?, ?, ?, 'confirmed', ?, ?, ?)`,
      args: [
        reservation.id,
        reservation.itemId,
        reservation.quantity,
        reservation.startDate,
        reservation.endDate,
        reservation.source,
        reservation.draftId,
        reservation.createdAt,
      ],
    })

    await transaction.execute({
      sql: `UPDATE drafts
               SET status = 'confirmed', reservation_id = ?, updated_at = ?
             WHERE id = ?`,
      args: [reservation.id, reservation.createdAt, draft.id],
    })

    await transaction.commit()
  } catch (error) {
    await transaction.rollback()

    // The unique constraint on draft_id fired: a concurrent confirmation
    // already wrote this draft's reservation. Return that one.
    if (isUniqueViolation(error)) {
      const existing = await getReservationByDraftId(draft.id)
      const current = await getDraftById(draft.id)
      return {
        outcome: 'already_confirmed',
        draft: current,
        reservation: existing,
        remaining: current ? await remainingFor(current) : null,
      }
    }

    throw error
  }

  const confirmed = await getDraftById(draft.id)
  const remaining = await remainingFor(reservation)

  await logEvent(draft.sessionId, 'booking_confirmed', {
    draftId: draft.id,
    reservationId: reservation.id,
    itemId: reservation.itemId,
    quantity: reservation.quantity,
    startDate: reservation.startDate,
    endDate: reservation.endDate,
    remaining,
  })

  return { outcome: 'confirmed', draft: confirmed, reservation, remaining }
}

export async function getReservationById(id: string): Promise<Reservation | null> {
  const result = await getDb().execute({
    sql: 'SELECT * FROM reservations WHERE id = ?',
    args: [id],
  })
  return result.rows.length > 0 ? rowToReservation(result.rows[0]) : null
}

export async function getReservationByDraftId(
  draftId: string,
): Promise<Reservation | null> {
  const result = await getDb().execute({
    sql: 'SELECT * FROM reservations WHERE draft_id = ?',
    args: [draftId],
  })
  return result.rows.length > 0 ? rowToReservation(result.rows[0]) : null
}

export async function listReservations(): Promise<Reservation[]> {
  const result = await getDb().execute(
    'SELECT * FROM reservations ORDER BY item_id, start_date',
  )
  return result.rows.map(rowToReservation)
}

async function remainingFor(
  target: Pick<Draft, 'itemId' | 'startDate' | 'endDate'>,
): Promise<number | null> {
  if (!target.itemId || !target.startDate || !target.endDate) return null
  const availability = await getAvailability(
    target.itemId,
    target.startDate,
    target.endDate,
  )
  return availability.available
}

async function markUnavailable(draft: Draft): Promise<void> {
  await getDb().execute({
    sql: `UPDATE drafts
             SET status = 'unavailable', confirmation_token = NULL, updated_at = ?
           WHERE id = ?`,
    args: [new Date().toISOString(), draft.id],
  })
}

function rowToReservation(row: Record<string, unknown>): Reservation {
  return {
    id: String(row.id),
    itemId: String(row.item_id),
    quantity: Number(row.quantity),
    startDate: String(row.start_date),
    endDate: String(row.end_date),
    draftId: row.draft_id === null ? null : String(row.draft_id),
    source: String(row.source),
    createdAt: String(row.created_at),
  }
}
