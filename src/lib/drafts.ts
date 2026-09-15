// The single booking request under discussion in a conversation, and the rules
// that keep a confirmation tied to exactly the version the customer agreed to.
//
// Invariant: every change bumps `version` and mints a fresh confirmation token,
// and a token is issued ONLY when the request is complete AND available. An
// incomplete, ambiguous, unavailable or superseded request therefore has no key
// to confirm with — the model cannot book it even if it tries.

import { randomUUID } from 'node:crypto'

import { resolveItem, type CatalogItem } from '@/config/catalog'
import { BOOKING_RULES } from '@/config/rules'
import {
  addDays,
  differenceInDays,
  getAvailability,
  isCalendarDate,
  type Availability,
} from './availability'
import { today } from './clock'
import { getDb, isUniqueViolation, type SqlExecutor } from './db'
import { logEvent } from './events'

export type DraftStatus = 'incomplete' | 'available' | 'unavailable' | 'confirmed'

/**
 * Every rule about a date range, in one place. `set_request` and
 * `check_availability` both call it, so a lookup is refused for the same
 * reason a request is — and says which reason, rather than one flat sentence
 * covering four different mistakes.
 *
 * Counted arithmetically, never by materialising the range: an unbounded span
 * has to be rejected without first allocating a day for each entry.
 */
/** The last start date the desk will take, from the rule rather than prose. */
export function latestBookableStart(): string {
  return addDays(today(), BOOKING_RULES.maxAdvanceDays)
}

export function dateReasons(startDate: string, endDate: string): ClarificationReason[] {
  if (!isCalendarDate(startDate) || !isCalendarDate(endDate)) return ['dates']
  if (startDate > endDate) return ['date_range']

  const todayIso = today()
  const days = differenceInDays(startDate, endDate) + 1

  if (startDate < todayIso) return ['past_dates']
  if (days < BOOKING_RULES.minRentalDays) return ['range_too_short']
  if (days > BOOKING_RULES.maxRentalDays) return ['range_too_long']
  if (differenceInDays(todayIso, startDate) > BOOKING_RULES.maxAdvanceDays) {
    return ['too_far_ahead']
  }
  return []
}

export type ClarificationReason =
  | 'item'
  | 'quantity'
  | 'dates'
  | 'date_range'
  | 'item_not_rented'
  | 'past_dates'
  | 'range_too_short'
  | 'range_too_long'
  | 'too_far_ahead'

export type Draft = {
  id: string
  sessionId: string
  version: number
  itemId: string | null
  quantity: number | null
  startDate: string | null
  endDate: string | null
  status: DraftStatus
  confirmationToken: string | null
  reservationId: string | null
  updatedAt: string
}

/**
 * A partial update. `undefined` leaves a field alone — which is what makes
 * "actually, make it the 16th to the 18th" change only the dates.
 */
export type DraftPatch = {
  item?: string | null
  quantity?: number | null
  startDate?: string | null
  endDate?: string | null
}

export type SetRequestResult = {
  draft: Draft
  availability: Availability | null
  clarificationNeeded: ClarificationReason[]
  itemCandidates: CatalogItem[]
}

export async function getDraftBySession(sessionId: string): Promise<Draft | null> {
  const result = await getDb().execute({
    sql: 'SELECT * FROM drafts WHERE session_id = ? ORDER BY rowid DESC LIMIT 1',
    args: [sessionId],
  })
  return result.rows.length > 0 ? rowToDraft(result.rows[0]) : null
}

export async function getDraftById(
  draftId: string,
  executor: SqlExecutor = getDb(),
): Promise<Draft | null> {
  const result = await executor.execute({
    sql: 'SELECT * FROM drafts WHERE id = ?',
    args: [draftId],
  })
  return result.rows.length > 0 ? rowToDraft(result.rows[0]) : null
}

/**
 * Creates or updates the conversation's draft, re-checks availability, and
 * rotates the confirmation token. This is the only way a draft ever changes.
 */
export async function setRequest(
  sessionId: string,
  patch: DraftPatch,
  options: { isRetry?: boolean } = {},
): Promise<SetRequestResult> {
  const previous = await getDraftBySession(sessionId)

  // A confirmed draft is terminal. A further request opens a fresh draft rather
  // than mutating a booking that already exists.
  const base = previous && previous.status !== 'confirmed' ? previous : null

  const clarificationNeeded: ClarificationReason[] = []
  let itemCandidates: CatalogItem[] = []

  let itemNotRented = false
  let itemId = base?.itemId ?? null
  let quantity = base?.quantity ?? null
  let startDate = base?.startDate ?? null
  let endDate = base?.endDate ?? null

  if (patch.item !== undefined) {
    if (patch.item === null || patch.item.trim().length === 0) {
      itemId = null
    } else {
      const resolved = resolveItem(patch.item)
      if (resolved.kind === 'resolved') {
        itemId = resolved.item.id
      } else {
        itemId = null
        if (resolved.kind === 'ambiguous') itemCandidates = resolved.candidates
        // Naming something we do not rent is not the same as not naming
        // anything, and the customer deserves to be told which it was.
        if (resolved.kind === 'not_found') itemNotRented = true
      }
    }
  }

  if (patch.quantity !== undefined) quantity = patch.quantity
  if (patch.startDate !== undefined) startDate = patch.startDate
  if (patch.endDate !== undefined) endDate = patch.endDate

  if (itemId === null) {
    clarificationNeeded.push(itemNotRented ? 'item_not_rented' : 'item')
  } else if (quantity === null) {
    quantity = BOOKING_RULES.defaultQuantity
  }

  if (quantity !== null && (!Number.isInteger(quantity) || quantity < 1)) {
    clarificationNeeded.push('quantity')
  }

  if (startDate === null || endDate === null) {
    clarificationNeeded.push('dates')
  } else if (!isCalendarDate(startDate) || !isCalendarDate(endDate)) {
    clarificationNeeded.push('dates')
  } else {
    clarificationNeeded.push(...dateReasons(startDate, endDate))
  }

  let status: DraftStatus = 'incomplete'
  let availability: Availability | null = null
  let confirmationToken: string | null = null

  // Written inline rather than via a boolean so TypeScript narrows the fields.
  if (
    clarificationNeeded.length === 0 &&
    itemId !== null &&
    quantity !== null &&
    startDate !== null &&
    endDate !== null
  ) {
    availability = await getAvailability(itemId, startDate, endDate)
    if (availability.available >= quantity) {
      status = 'available'
      confirmationToken = randomUUID()
    } else {
      status = 'unavailable'
    }
  }

  const draft: Draft = {
    id: base?.id ?? randomUUID(),
    sessionId,
    version: base ? base.version + 1 : 1,
    itemId,
    quantity,
    startDate,
    endDate,
    status,
    confirmationToken,
    reservationId: null,
    updatedAt: new Date().toISOString(),
  }

  try {
    await persistDraft(draft, base !== null)
  } catch (error) {
    // A concurrent set_request opened this session's draft first. Apply this
    // patch on top of that one rather than leaving a second, unreachable draft
    // holding a token no later correction could rotate.
    if (base === null && !options.isRetry && isUniqueViolation(error)) {
      return setRequest(sessionId, patch, { isRetry: true })
    }
    throw error
  }

  await logEvent(sessionId, 'draft_updated', {
    draftId: draft.id,
    version: draft.version,
    status: draft.status,
    itemId: draft.itemId,
    quantity: draft.quantity,
    startDate: draft.startDate,
    endDate: draft.endDate,
    tokenIssued: draft.confirmationToken !== null,
    clarificationNeeded,
    supersededVersion: base?.version ?? null,
  })

  return { draft, availability, clarificationNeeded, itemCandidates }
}

async function persistDraft(draft: Draft, isUpdate: boolean): Promise<void> {
  const db = getDb()

  if (isUpdate) {
    await db.execute({
      sql: `UPDATE drafts
               SET version = ?, item_id = ?, quantity = ?, start_date = ?, end_date = ?,
                   status = ?, confirmation_token = ?, reservation_id = ?, updated_at = ?
             WHERE id = ?`,
      args: [
        draft.version,
        draft.itemId,
        draft.quantity,
        draft.startDate,
        draft.endDate,
        draft.status,
        draft.confirmationToken,
        draft.reservationId,
        draft.updatedAt,
        draft.id,
      ],
    })
    return
  }

  await db.execute({
    sql: `INSERT INTO drafts
            (id, session_id, version, item_id, quantity, start_date, end_date,
             status, confirmation_token, reservation_id, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      draft.id,
      draft.sessionId,
      draft.version,
      draft.itemId,
      draft.quantity,
      draft.startDate,
      draft.endDate,
      draft.status,
      draft.confirmationToken,
      draft.reservationId,
      draft.updatedAt,
    ],
  })
}

function rowToDraft(row: Record<string, unknown>): Draft {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    version: Number(row.version),
    itemId: row.item_id === null ? null : String(row.item_id),
    quantity: row.quantity === null ? null : Number(row.quantity),
    startDate: row.start_date === null ? null : String(row.start_date),
    endDate: row.end_date === null ? null : String(row.end_date),
    status: String(row.status) as DraftStatus,
    confirmationToken:
      row.confirmation_token === null ? null : String(row.confirmation_token),
    reservationId: row.reservation_id === null ? null : String(row.reservation_id),
    updatedAt: String(row.updated_at),
  }
}
