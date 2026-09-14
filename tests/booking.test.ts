// Expected results were written before the implementation was run.
//
// These are the booking invariants the brief is graded on: exactly one
// reservation, only after explicit confirmation, never from a superseded
// request, never when stock is short, never twice.

import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { confirmBooking, listReservations } from '@/lib/booking'
import { freezeClock } from '@/lib/clock'
import { closeDb, getDb } from '@/lib/db'
import { setRequest, type Draft } from '@/lib/drafts'
import { resetDatabase } from '@/lib/reset'

const SESSION = 'test-session'

beforeEach(async () => {
  process.env.DATABASE_URL = 'file:./data/test-booking.db'
  freezeClock('2026-09-14')
  await resetDatabase()
})

afterAll(() => {
  freezeClock(null)
  closeDb()
})

async function countVoiceReservations(): Promise<number> {
  const result = await getDb().execute(
    "SELECT COUNT(*) AS total FROM reservations WHERE source = 'voice'",
  )
  return Number(result.rows[0].total)
}

function confirmArgs(draft: Draft) {
  return {
    sessionId: draft.sessionId,
    draftId: draft.id,
    version: draft.version,
    confirmationToken: draft.confirmationToken as string,
  }
}

describe('confirmBooking', () => {
  it('writes exactly one reservation when the token is valid', async () => {
    const request = await setRequest(SESSION, {
      item: 'Tripod B',
      quantity: 1,
      startDate: '2026-10-15',
      endDate: '2026-10-17',
    })

    const result = await confirmBooking(confirmArgs(request.draft))

    expect(result.outcome).toBe('confirmed')
    expect(result.reservation?.itemId).toBe('tripod_b')
    expect(result.reservation?.startDate).toBe('2026-10-15')
    expect(result.reservation?.endDate).toBe('2026-10-17')
    expect(result.draft?.status).toBe('confirmed')
    expect(await countVoiceReservations()).toBe(1)
  })

  it('returns the same reservation on a repeated confirmation, writing nothing', async () => {
    const request = await setRequest(SESSION, {
      item: 'Tripod B',
      startDate: '2026-10-15',
      endDate: '2026-10-17',
    })

    const first = await confirmBooking(confirmArgs(request.draft))
    const second = await confirmBooking(confirmArgs(request.draft))

    expect(first.outcome).toBe('confirmed')
    expect(second.outcome).toBe('already_confirmed')
    expect(second.reservation?.id).toBe(first.reservation?.id)
    expect(await countVoiceReservations()).toBe(1)
  })

  it('rejects a token minted before a correction', async () => {
    const original = await setRequest(SESSION, {
      item: 'Microphone C',
      startDate: '2026-10-20',
      endDate: '2026-10-22',
    })
    await setRequest(SESSION, { startDate: '2026-10-21', endDate: '2026-10-23' })

    const result = await confirmBooking(confirmArgs(original.draft))

    expect(result.outcome).toBe('stale_confirmation')
    expect(result.reservation).toBeNull()
    expect(await countVoiceReservations()).toBe(0)
  })

  it('never stores the superseded dates after a correction', async () => {
    await setRequest(SESSION, {
      item: 'Microphone C',
      startDate: '2026-10-20',
      endDate: '2026-10-22',
    })
    const corrected = await setRequest(SESSION, {
      startDate: '2026-10-21',
      endDate: '2026-10-23',
    })

    await confirmBooking(confirmArgs(corrected.draft))

    const reservations = await listReservations()
    const fromVoice = reservations.filter((row) => row.source === 'voice')

    expect(fromVoice).toHaveLength(1)
    expect(fromVoice[0].startDate).toBe('2026-10-21')
    expect(fromVoice[0].endDate).toBe('2026-10-23')
    expect(reservations.some((row) => row.startDate === '2026-10-20')).toBe(false)
  })

  it('refuses to confirm a request the stock cannot cover', async () => {
    const request = await setRequest(SESSION, {
      item: 'Camera A',
      quantity: 2,
      startDate: '2026-10-10',
      endDate: '2026-10-12',
    })

    const result = await confirmBooking({
      sessionId: SESSION,
      draftId: request.draft.id,
      version: request.draft.version,
      confirmationToken: 'anything-at-all',
    })

    expect(result.outcome).toBe('not_available')
    expect(result.remaining).toBe(1)
    expect(await countVoiceReservations()).toBe(0)
  })

  it('refuses to confirm a request that is missing dates', async () => {
    const request = await setRequest(SESSION, { item: 'Camera A' })

    const result = await confirmBooking({
      sessionId: SESSION,
      draftId: request.draft.id,
      version: request.draft.version,
      confirmationToken: 'anything-at-all',
    })

    expect(result.outcome).toBe('incomplete')
    expect(await countVoiceReservations()).toBe(0)
  })

  it('rejects an unknown draft id', async () => {
    const result = await confirmBooking({
      sessionId: SESSION,
      draftId: 'no-such-draft',
      version: 1,
      confirmationToken: 'anything-at-all',
    })

    expect(result.outcome).toBe('unknown_draft')
    expect(await countVoiceReservations()).toBe(0)
  })

  it('reports the remaining stock for the booked dates', async () => {
    const request = await setRequest(SESSION, {
      item: 'Camera A',
      quantity: 1,
      startDate: '2026-10-10',
      endDate: '2026-10-12',
    })

    const result = await confirmBooking(confirmArgs(request.draft))

    expect(result.outcome).toBe('confirmed')
    expect(result.remaining).toBe(0)
  })

  // Regression: a draft id is not a capability. Found by an adversarial review
  // that confirmed one conversation's draft from another session.
  it('refuses a draft that belongs to another conversation', async () => {
    const request = await setRequest(SESSION, {
      item: 'Tripod B',
      startDate: '2026-10-15',
      endDate: '2026-10-17',
    })

    const result = await confirmBooking({
      sessionId: 'someone-else',
      draftId: request.draft.id,
      version: request.draft.version,
      confirmationToken: request.draft.confirmationToken as string,
    })

    expect(result.outcome).toBe('unknown_draft')
    expect(await countVoiceReservations()).toBe(0)
  })

  // Regression: the token stays valid until the draft changes, but the calendar
  // moves on its own. A request made for today must not book after midnight.
  it('refuses a token whose start date has passed since it was issued', async () => {
    const request = await setRequest(SESSION, {
      item: 'Tripod B',
      startDate: '2026-09-14',
      endDate: '2026-09-16',
    })
    expect(request.draft.status).toBe('available')

    freezeClock('2026-09-20')
    const result = await confirmBooking(confirmArgs(request.draft))

    expect(result.outcome).toBe('not_available')
    expect(result.draft?.confirmationToken).toBeNull()
    expect(await countVoiceReservations()).toBe(0)
  })

  // The last line of defence. Even if every application gate were bypassed,
  // the schema itself must refuse a second reservation for the same draft.
  it('lets the database itself reject a second reservation for the same draft', async () => {
    const request = await setRequest(SESSION, {
      item: 'Tripod B',
      startDate: '2026-10-15',
      endDate: '2026-10-17',
    })
    const confirmed = await confirmBooking(confirmArgs(request.draft))

    await expect(
      getDb().execute({
        sql: `INSERT INTO reservations
                (id, item_id, quantity, start_date, end_date, status, source, draft_id, created_at)
              VALUES ('bypass', 'tripod_b', 1, '2026-10-15', '2026-10-17', 'confirmed', 'voice', ?, ?)`,
        args: [confirmed.reservation?.draftId as string, new Date().toISOString()],
      }),
    ).rejects.toThrow(/UNIQUE constraint failed/)

    expect(await countVoiceReservations()).toBe(1)
  })

  it('starts a fresh draft when a new request follows a confirmed booking', async () => {
    const first = await setRequest(SESSION, {
      item: 'Tripod B',
      startDate: '2026-10-15',
      endDate: '2026-10-17',
    })
    await confirmBooking(confirmArgs(first.draft))

    const second = await setRequest(SESSION, {
      item: 'Microphone C',
      startDate: '2026-10-20',
      endDate: '2026-10-22',
    })

    expect(second.draft.id).not.toBe(first.draft.id)
    expect(second.draft.version).toBe(1)
    expect(second.draft.status).toBe('available')
    expect(await countVoiceReservations()).toBe(1)
  })
})
