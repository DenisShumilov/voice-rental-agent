// Runs the six required checks through the real tool layer.
// Expectations live in src/lib/scenarios.ts and were written before the run.
// The reviewer page executes this exact code, so the page and the suite can
// never disagree about what passed.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { freezeClock } from '@/lib/clock'
import { closeDb } from '@/lib/db'
import { runScenario, SCENARIOS } from '@/lib/scenarios'

beforeAll(() => {
  process.env.DATABASE_URL = 'file:./data/test-scenarios.db'
})

afterAll(() => {
  freezeClock(null)
  closeDb()
})

describe('required scenarios', () => {
  for (const scenario of SCENARIOS) {
    it(`${scenario.id} — ${scenario.title}`, async () => {
      const result = await runScenario(scenario)

      const failures = result.checks
        .filter((item) => !item.passed)
        .map(
          (item) =>
            `${item.label}: expected ${JSON.stringify(item.expected)}, got ${JSON.stringify(item.actual)}`,
        )

      expect(failures).toEqual([])
      expect(result.passed).toBe(true)
    })
  }

  it('covers exactly the six checks the brief asks for', () => {
    expect(SCENARIOS.map((scenario) => scenario.id)).toEqual([
      'TC01',
      'TC02',
      'TC03',
      'TC04',
      'TC05',
      'TC06',
    ])
  })
})
