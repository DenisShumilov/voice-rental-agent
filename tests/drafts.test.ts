// Expected results were written before the implementation was run.
//
// Fixture: Camera A has 2 units with 1 booked 10-12 October 2026 inclusive,
// Tripod B has 3 units, Microphone C has 1.

import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { freezeClock } from '@/lib/clock'
import { closeDb, getDb } from '@/lib/db'
import { setRequest } from '@/lib/drafts'
import { resetDatabase } from '@/lib/reset'

const SESSION = 'test-session'

beforeEach(async () => {
  process.env.DATABASE_URL = 'file:./data/test-drafts.db'
  freezeClock('2026-09-14')
  await resetDatabase()
})

afterAll(() => {
  freezeClock(null)
  closeDb()
})

describe('setRequest', () => {
  it('marks a complete, available request as available and issues a token', async () => {
    const result = await setRequest(SESSION, {
      item: 'Tripod B',
      quantity: 1,
      startDate: '2026-10-15',
      endDate: '2026-10-17',
    })

    expect(result.draft.version).toBe(1)
    expect(result.draft.status).toBe('available')
    expect(result.draft.confirmationToken).not.toBeNull()
    expect(result.clarificationNeeded).toEqual([])
    expect(result.availability?.available).toBe(3)
  })

  it('leaves a request without dates incomplete and issues no token', async () => {
    const result = await setRequest(SESSION, { item: 'Camera A' })

    expect(result.draft.status).toBe('incomplete')
    expect(result.draft.confirmationToken).toBeNull()
    expect(result.clarificationNeeded).toContain('dates')
  })

  it('refuses to guess when a phrase matches more than one item', async () => {
    const result = await setRequest(SESSION, {
      item: 'a camera and a tripod',
      startDate: '2026-10-15',
      endDate: '2026-10-17',
    })

    expect(result.draft.itemId).toBeNull()
    expect(result.draft.status).toBe('incomplete')
    expect(result.draft.confirmationToken).toBeNull()
    expect(result.clarificationNeeded).toContain('item')
    expect(result.itemCandidates.map((item) => item.id)).toEqual(['camera_a', 'tripod_b'])
  })

  it('bumps the version and rotates the token on a correction', async () => {
    const first = await setRequest(SESSION, {
      item: 'Microphone C',
      startDate: '2026-10-20',
      endDate: '2026-10-22',
    })
    const second = await setRequest(SESSION, {
      startDate: '2026-10-21',
      endDate: '2026-10-23',
    })

    expect(first.draft.version).toBe(1)
    expect(second.draft.version).toBe(2)
    expect(second.draft.id).toBe(first.draft.id)
    expect(second.draft.confirmationToken).not.toBe(first.draft.confirmationToken)
    expect(second.draft.confirmationToken).not.toBeNull()
  })

  it('changes only the fields supplied in a correction', async () => {
    await setRequest(SESSION, {
      item: 'Microphone C',
      quantity: 1,
      startDate: '2026-10-20',
      endDate: '2026-10-22',
    })
    const corrected = await setRequest(SESSION, {
      startDate: '2026-10-21',
      endDate: '2026-10-23',
    })

    expect(corrected.draft.itemId).toBe('mic_c')
    expect(corrected.draft.quantity).toBe(1)
    expect(corrected.draft.startDate).toBe('2026-10-21')
    expect(corrected.draft.endDate).toBe('2026-10-23')
  })

  it('marks a request for more units than exist as unavailable, with no token', async () => {
    const result = await setRequest(SESSION, {
      item: 'Camera A',
      quantity: 2,
      startDate: '2026-10-10',
      endDate: '2026-10-12',
    })

    expect(result.draft.status).toBe('unavailable')
    expect(result.draft.confirmationToken).toBeNull()
    expect(result.availability?.available).toBe(1)
  })

  it('assumes one unit when no quantity is given', async () => {
    const result = await setRequest(SESSION, {
      item: 'Camera A',
      startDate: '2026-10-13',
      endDate: '2026-10-15',
    })

    expect(result.draft.quantity).toBe(1)
    expect(result.draft.status).toBe('available')
  })

  // Regression: setRequest reads the session's draft and then writes it, with
  // an await in between. An adversarial review used that window to open two
  // drafts for one conversation; the loser kept a token no correction could
  // rotate, and it booked. The database now allows only one live draft.
  it('leaves exactly one live draft when two requests arrive at once', async () => {
    const [first, second] = await Promise.all([
      setRequest(SESSION, {
        item: 'Camera A',
        startDate: '2026-11-01',
        endDate: '2026-11-03',
      }),
      setRequest(SESSION, {
        item: 'Tripod B',
        startDate: '2026-11-01',
        endDate: '2026-11-03',
      }),
    ])

    const rows = await getDb().execute({
      sql: "SELECT id FROM drafts WHERE session_id = ? AND status <> 'confirmed'",
      args: [SESSION],
    })

    expect(rows.rows).toHaveLength(1)
    expect(first.draft.id).toBe(second.draft.id)
  })

  it('rejects a date range that ends before it starts, with no token', async () => {
    const result = await setRequest(SESSION, {
      item: 'Tripod B',
      startDate: '2026-10-17',
      endDate: '2026-10-15',
    })

    expect(result.draft.status).toBe('incomplete')
    expect(result.draft.confirmationToken).toBeNull()
    expect(result.clarificationNeeded).toContain('date_range')
  })
})
