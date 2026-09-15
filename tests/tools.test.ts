// The model is an untrusted caller. These check that bad, hostile or simply
// odd tool arguments are refused without touching the database.

import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { CATALOG } from '@/config/catalog'
import { BOOKING_RULES } from '@/config/rules'
import { freezeClock } from '@/lib/clock'
import { closeDb, getDb } from '@/lib/db'
import { getDraftBySession } from '@/lib/drafts'
import { resetDatabase } from '@/lib/reset'
import { dispatchTool } from '@/lib/tools'

const SESSION = 'test-session'
const TODAY = '2026-09-14'
const [CAMERA, TRIPOD] = CATALOG

beforeEach(async () => {
  process.env.DATABASE_URL = 'file:./data/test-tools.db'
  freezeClock(TODAY)
  await resetDatabase()
})

afterAll(() => {
  freezeClock(null)
  closeDb()
})

async function countReservations(): Promise<number> {
  const result = await getDb().execute('SELECT COUNT(*) AS total FROM reservations')
  return Number(result.rows[0].total)
}

describe('dispatchTool', () => {
  it('refuses a tool that does not exist', async () => {
    const result = await dispatchTool(SESSION, 'delete_everything', { confirm: true })

    expect(result.status).toBe('unknown_tool')
    expect(await countReservations()).toBe(1)
  })

  it('refuses a confirmation with missing arguments', async () => {
    const result = await dispatchTool(SESSION, 'confirm_booking', { draft_id: 'x' })

    expect(result.status).toBe('invalid_arguments')
    expect(await countReservations()).toBe(1)
  })

  it('accepts a version sent as a string, since models are not typed', async () => {
    const request = await dispatchTool(SESSION, 'set_request', {
      item: TRIPOD.name,
      start_date: '2026-10-15',
      end_date: '2026-10-17',
    })

    const result = await dispatchTool(SESSION, 'confirm_booking', {
      draft_id: request.facts.draft_id,
      version: String(request.facts.version),
      confirmation_token: request.facts.confirmation_token,
    })

    expect(result.status).toBe('confirmed')
  })

  it('asks for dates rather than accepting a date it cannot parse', async () => {
    const result = await dispatchTool(SESSION, 'set_request', {
      item: CAMERA.name,
      start_date: 'next Tuesday',
      end_date: 'the Thursday after',
    })

    expect(result.status).toBe('needs_clarification')
    expect(result.facts.needs).toContain('dates')
    expect(result.facts.confirmation_token).toBeUndefined()
  })

  it('refuses a start date that has already passed', async () => {
    const result = await dispatchTool(SESSION, 'set_request', {
      item: CAMERA.name,
      start_date: '2026-09-01',
      end_date: '2026-09-03',
    })

    expect(result.status).toBe('needs_clarification')
    expect(result.facts.needs).toContain('past_dates')
  })

  it('refuses a rental longer than the maximum', async () => {
    const result = await dispatchTool(SESSION, 'set_request', {
      item: TRIPOD.name,
      start_date: '2026-10-01',
      end_date: '2026-11-09',
    })

    expect(BOOKING_RULES.maxRentalDays).toBe(30)
    expect(result.status).toBe('needs_clarification')
    expect(result.facts.needs).toContain('range_too_long')
  })

  it('says we do not rent it, rather than asking which item was meant', async () => {
    const result = await dispatchTool(SESSION, 'set_request', {
      item: 'a drone',
      start_date: '2026-10-15',
      end_date: '2026-10-17',
    })

    expect(result.status).toBe('needs_clarification')
    // Naming something we do not stock is a different answer from naming
    // nothing at all: one is declined, the other is asked about.
    expect(result.facts.needs).toContain('item_not_rented')
    expect(result.guidance).toContain('do not rent')
    for (const catalogItem of CATALOG) {
      expect(result.guidance).toContain(catalogItem.name)
    }
  })

  it('says more than we own is impossible, not merely unavailable', async () => {
    // "Only 2 of 2 are free" is what the customer used to hear after asking for
    // five of something we own two of: a contradiction, followed by an offer of
    // different dates that could never help.
    const result = await dispatchTool(SESSION, 'set_request', {
      item: CAMERA.name,
      quantity: CAMERA.totalStock + 3,
      start_date: '2026-12-01',
      end_date: '2026-12-02',
    })

    expect(result.status).toBe('unavailable')
    expect(result.guidance).toContain('only ever have')
    expect(result.guidance).toContain('different dates will not help')
    expect(result.facts.confirmation_token).toBeUndefined()
  })

  it('says every unit is committed when none are free, and does not offer fewer', async () => {
    const booked = await dispatchTool(SESSION, 'set_request', {
      item: TRIPOD.name,
      quantity: TRIPOD.totalStock,
      start_date: '2026-12-08',
      end_date: '2026-12-09',
    })
    expect(booked.status).toBe('available')

    await dispatchTool(SESSION, 'confirm_booking', {
      draft_id: booked.facts.draft_id,
      version: booked.facts.version,
      confirmation_token: booked.facts.confirmation_token,
    })

    const blocked = await dispatchTool('another-session', 'set_request', {
      item: TRIPOD.name,
      quantity: 1,
      start_date: '2026-12-08',
      end_date: '2026-12-09',
    })

    expect(blocked.status).toBe('unavailable')
    expect(blocked.guidance).toContain('already committed')
    // The guidance may mention fewer units only to rule them out: with every
    // unit taken, offering a smaller number is an offer that cannot be met.
    expect(blocked.guidance).toContain('Only different dates help')
    expect(blocked.guidance).toContain('fewer units will not')
  })

  it('still asks which item when the customer has named none', async () => {
    const result = await dispatchTool(SESSION, 'set_request', {
      start_date: '2026-10-15',
      end_date: '2026-10-17',
    })

    expect(result.status).toBe('needs_clarification')
    expect(result.facts.needs).toContain('item')
    expect(result.facts.needs).not.toContain('item_not_rented')
  })

  // Regression: availability walks one entry per day. An adversarial review
  // submitted a ten-thousand-year span here and blocked the server for seconds
  // on a single request. The span is now bounded before it is expanded.
  it('refuses a lookup span longer than the maximum rental, and says so', async () => {
    const started = Date.now()
    const result = await dispatchTool(SESSION, 'check_availability', {
      item: CAMERA.name,
      start_date: '2026-10-01',
      end_date: '9999-12-31',
    })

    expect(result.status).toBe('needs_clarification')
    // The named reason, not a flat "ask for dates": the customer gave a
    // perfectly clear range, it is just too long, and the agent has to be able
    // to say which of the four date rules was broken.
    expect(result.facts.needs).toContain('range_too_long')
    expect(result.guidance).toContain(String(BOOKING_RULES.maxRentalDays))
    expect(Date.now() - started).toBeLessThan(1000)
  })

  it('refuses a lookup in the past, the same as a request in the past', async () => {
    const result = await dispatchTool(SESSION, 'check_availability', {
      item: CAMERA.name,
      start_date: '2020-01-01',
      end_date: '2020-01-03',
    })

    expect(result.status).toBe('needs_clarification')
    expect(result.facts.needs).toContain('past_dates')
    expect(result.guidance.toLowerCase()).toContain('passed')
  })

  it('refuses a reversed lookup range for being reversed', async () => {
    const result = await dispatchTool(SESSION, 'check_availability', {
      item: CAMERA.name,
      start_date: '2026-10-20',
      end_date: '2026-10-18',
    })

    expect(result.status).toBe('needs_clarification')
    expect(result.facts.needs).toContain('date_range')
  })

  it('leaves the current request untouched when only looking up availability', async () => {
    await dispatchTool(SESSION, 'set_request', {
      item: TRIPOD.name,
      start_date: '2026-10-15',
      end_date: '2026-10-17',
    })
    const before = await getDraftBySession(SESSION)

    const lookup = await dispatchTool(SESSION, 'check_availability', {
      item: CAMERA.name,
      start_date: '2026-12-01',
      end_date: '2026-12-02',
    })
    const after = await getDraftBySession(SESSION)

    expect(lookup.status).toBe('ok')
    expect(lookup.facts.available).toBe(CAMERA.totalStock)
    expect(after?.version).toBe(before?.version)
    expect(after?.startDate).toBe('2026-10-15')
    expect(after?.confirmationToken).toBe(before?.confirmationToken)
  })
})
