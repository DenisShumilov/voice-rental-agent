// The six required checks, defined once and run from two places: the test
// suite, and the reviewer page's "run all" button.
//
// Invariant: expectations are declared here, in code, alongside the steps that
// produce them — so the page a reviewer clicks and the suite CI runs can never
// drift apart. Each scenario drives the real tool layer; nothing is stubbed.

import { CATALOG } from '@/config/catalog'
import { SEED_RESERVATIONS } from '@/config/seed'
import { listReservations, type Reservation } from './booking'
import { freezeClock } from './clock'
import { resetDatabase } from './reset'
import { dispatchTool, type ToolResult } from './tools'

/** Pinned so "is that date in the past?" has the same answer every run. */
export const SCENARIO_TODAY = '2026-09-14'

const [CAMERA, TRIPOD, MIC] = CATALOG
const SEEDED = SEED_RESERVATIONS[0]

export type Check = {
  label: string
  expected: unknown
  actual: unknown
  passed: boolean
}

export type StepLog = {
  spoken: string | null
  tool: string
  args: unknown
  status: string
  facts: Record<string, unknown>
}

export type DatabaseSnapshot = {
  reservations: Array<Pick<Reservation, 'itemId' | 'quantity' | 'startDate' | 'endDate' | 'source'>>
  total: number
}

export type ScenarioResult = {
  id: string
  title: string
  requirements: string[]
  given: string
  steps: StepLog[]
  checks: Check[]
  passed: boolean
  before: DatabaseSnapshot
  after: DatabaseSnapshot
}

type Context = {
  sessionId: string
  /** Calls a tool as the model would, recording what was said and what came back. */
  call(spoken: string | null, tool: string, args: unknown): Promise<ToolResult>
  reservations(): Promise<Reservation[]>
}

type Scenario = {
  id: string
  title: string
  requirements: string[]
  given: string
  run(context: Context): Promise<Check[]>
}

function check(label: string, expected: unknown, actual: unknown): Check {
  return {
    label,
    expected,
    actual,
    passed: JSON.stringify(expected ?? null) === JSON.stringify(actual ?? null),
  }
}

async function voiceBookings(context: Context): Promise<Reservation[]> {
  const all = await context.reservations()
  return all.filter((reservation) => reservation.source === 'voice')
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'TC01',
    title: 'Normal booking',
    requirements: ['R5', 'R7', 'R8'],
    given: `${TRIPOD.name} has ${TRIPOD.totalStock} units and no existing bookings.`,
    async run(context) {
      const request = await context.call(
        `I need one ${TRIPOD.name} from October 15 to 17.`,
        'set_request',
        { item: TRIPOD.name, quantity: 1, start_date: '2026-10-15', end_date: '2026-10-17' },
      )

      const confirmation = await context.call('Yes, confirm.', 'confirm_booking', {
        draft_id: request.facts.draft_id,
        version: request.facts.version,
        confirmation_token: request.facts.confirmation_token,
      })

      const booked = await voiceBookings(context)

      return [
        check('request is available', 'available', request.status),
        check('a confirmation token was issued', true, typeof request.facts.confirmation_token === 'string'),
        check('booking is confirmed', 'confirmed', confirmation.status),
        check('exactly one reservation saved', 1, booked.length),
        check('booked dates', '2026-10-15 to 2026-10-17', `${booked[0]?.startDate} to ${booked[0]?.endDate}`),
        check('remaining for those dates', 2, confirmation.facts.remaining_for_those_dates),
      ]
    },
  },

  {
    id: 'TC02',
    title: 'Corrected dates',
    requirements: ['R3', 'R20'],
    given: `${MIC.name} has ${MIC.totalStock} unit. The customer gives dates, then changes them before confirming.`,
    async run(context) {
      const original = await context.call(
        `Book ${MIC.name} from October 20 to 22.`,
        'set_request',
        { item: MIC.name, start_date: '2026-10-20', end_date: '2026-10-22' },
      )

      const corrected = await context.call(
        'Actually, make that October 21 to 23.',
        'set_request',
        { start_date: '2026-10-21', end_date: '2026-10-23' },
      )

      const confirmation = await context.call('Yes, confirm.', 'confirm_booking', {
        draft_id: corrected.facts.draft_id,
        version: corrected.facts.version,
        confirmation_token: corrected.facts.confirmation_token,
      })

      const booked = await voiceBookings(context)
      const all = await context.reservations()

      return [
        check('correction bumped the version', 2, corrected.facts.version),
        check(
          'the old confirmation token was replaced',
          true,
          original.facts.confirmation_token !== corrected.facts.confirmation_token,
        ),
        check('booking is confirmed', 'confirmed', confirmation.status),
        check('exactly one reservation saved', 1, booked.length),
        check('saved dates are the corrected ones', '2026-10-21 to 2026-10-23', `${booked[0]?.startDate} to ${booked[0]?.endDate}`),
        check(
          'no reservation holds the superseded dates',
          0,
          all.filter((row) => row.startDate === '2026-10-20').length,
        ),
      ]
    },
  },

  {
    id: 'TC03',
    title: 'Insufficient stock',
    requirements: ['R6', 'R22'],
    given: `${CAMERA.name} has ${CAMERA.totalStock} units and ${SEEDED.quantity} is already booked ${SEEDED.startDate} to ${SEEDED.endDate} inclusive.`,
    async run(context) {
      const request = await context.call(
        `I need two ${CAMERA.name} from October 10 to 12.`,
        'set_request',
        {
          item: CAMERA.name,
          quantity: 2,
          start_date: SEEDED.startDate,
          end_date: SEEDED.endDate,
        },
      )

      // The model has no token, so this is the worst it could do: try anyway.
      const attempt = await context.call('Yes, confirm.', 'confirm_booking', {
        draft_id: request.facts.draft_id,
        version: request.facts.version,
        confirmation_token: 'no-token-was-issued',
      })

      const booked = await voiceBookings(context)

      return [
        check('request is unavailable', 'unavailable', request.status),
        check('only one unit is free', 1, request.facts.available),
        check('no confirmation token was issued', undefined, request.facts.confirmation_token),
        check('confirmation is refused', 'not_available', attempt.status),
        check('no reservation was saved', 0, booked.length),
      ]
    },
  },

  {
    id: 'TC04',
    title: 'Interruption mid-answer',
    requirements: ['R19', 'R20'],
    given: 'The assistant is part-way through answering when the customer interrupts with different dates.',
    async run(context) {
      const interrupted = await context.call(
        `I need ${CAMERA.name} from October 10 to 12.`,
        'set_request',
        {
          item: CAMERA.name,
          quantity: 1,
          start_date: SEEDED.startDate,
          end_date: SEEDED.endDate,
        },
      )

      const afterBargeIn = await context.call(
        `Actually, make that ${CAMERA.name} from October 13 to 14.`,
        'set_request',
        { start_date: '2026-10-13', end_date: '2026-10-14' },
      )

      // The half-finished turn tries to confirm what it was already saying.
      const stale = await context.call(null, 'confirm_booking', {
        draft_id: interrupted.facts.draft_id,
        version: interrupted.facts.version,
        confirmation_token: interrupted.facts.confirmation_token,
      })

      const confirmation = await context.call('Yes, confirm.', 'confirm_booking', {
        draft_id: afterBargeIn.facts.draft_id,
        version: afterBargeIn.facts.version,
        confirmation_token: afterBargeIn.facts.confirmation_token,
      })

      const booked = await voiceBookings(context)

      return [
        check('the interrupted turn cannot confirm', 'stale_confirmation', stale.status),
        check('the corrected request confirms', 'confirmed', confirmation.status),
        check('exactly one reservation saved', 1, booked.length),
        check('saved dates are the ones said last', '2026-10-13 to 2026-10-14', `${booked[0]?.startDate} to ${booked[0]?.endDate}`),
        check(
          'the abandoned dates were never saved',
          0,
          booked.filter((row) => row.startDate === SEEDED.startDate).length,
        ),
      ]
    },
  },

  {
    id: 'TC05',
    title: 'Repeated confirmation',
    requirements: ['R7', 'R23'],
    given: 'The customer confirms, then says "yes, confirm it" again.',
    async run(context) {
      const request = await context.call(
        `One ${TRIPOD.name} from October 15 to 17, please.`,
        'set_request',
        { item: TRIPOD.name, start_date: '2026-10-15', end_date: '2026-10-17' },
      )

      const args = {
        draft_id: request.facts.draft_id,
        version: request.facts.version,
        confirmation_token: request.facts.confirmation_token,
      }

      const first = await context.call('Yes, confirm.', 'confirm_booking', args)
      const second = await context.call('Yes, confirm it.', 'confirm_booking', args)

      const booked = await voiceBookings(context)

      return [
        check('first confirmation books', 'confirmed', first.status),
        check('second confirmation is a replay', 'already_confirmed', second.status),
        check(
          'both return the same booking reference',
          first.facts.booking_reference,
          second.facts.booking_reference,
        ),
        check('still exactly one reservation', 1, booked.length),
      ]
    },
  },

  {
    id: 'TC06',
    title: 'Ambiguous dates',
    requirements: ['R21'],
    given: 'The customer names an item but not dates the system can resolve.',
    async run(context) {
      const request = await context.call(
        'I need the camera next week.',
        'set_request',
        { item: 'the camera' },
      )

      const attempt = await context.call(null, 'confirm_booking', {
        draft_id: request.facts.draft_id,
        version: request.facts.version,
        confirmation_token: 'no-token-was-issued',
      })

      const booked = await voiceBookings(context)

      return [
        check('the request needs clarification', 'needs_clarification', request.status),
        check('the item was understood', CAMERA.name, request.facts.item),
        check('the dates were not', null, request.facts.start_date),
        check('clarification is about dates', true, Array.isArray(request.facts.needs) && (request.facts.needs as string[]).includes('dates')),
        check('no confirmation token was issued', undefined, request.facts.confirmation_token),
        check('confirmation is refused', 'incomplete', attempt.status),
        check('no reservation was saved', 0, booked.length),
      ]
    },
  },
]

export async function runScenario(scenario: Scenario): Promise<ScenarioResult> {
  freezeClock(SCENARIO_TODAY)
  await resetDatabase()

  const sessionId = `scenario-${scenario.id}`
  const steps: StepLog[] = []

  const context: Context = {
    sessionId,
    async call(spoken, tool, args) {
      const result = await dispatchTool(sessionId, tool, args)
      steps.push({ spoken, tool, args, status: result.status, facts: result.facts })
      return result
    },
    reservations: listReservations,
  }

  const before = await snapshot()
  const checks = await scenario.run(context)
  const after = await snapshot()

  return {
    id: scenario.id,
    title: scenario.title,
    requirements: scenario.requirements,
    given: scenario.given,
    steps,
    checks,
    passed: checks.every((item) => item.passed),
    before,
    after,
  }
}

export async function runAllScenarios(): Promise<ScenarioResult[]> {
  const results: ScenarioResult[] = []
  for (const scenario of SCENARIOS) {
    results.push(await runScenario(scenario))
  }
  return results
}

async function snapshot(): Promise<DatabaseSnapshot> {
  const reservations = await listReservations()
  return {
    reservations: reservations.map((row) => ({
      itemId: row.itemId,
      quantity: row.quantity,
      startDate: row.startDate,
      endDate: row.endDate,
      source: row.source,
    })),
    total: reservations.length,
  }
}
