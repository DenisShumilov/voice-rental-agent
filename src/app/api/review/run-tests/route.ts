// Runs the six required checks on demand, so a reviewer can reproduce them
// from the page rather than from a terminal.
//
// Invariant: the run happens against a scratch database, never the one holding
// the demo's bookings. The scenarios reset the database they run on, so
// pointing them at the live one would destroy the evidence they exist to show.

import { NextResponse } from 'next/server'

import { freezeClock } from '@/lib/clock'
import { closeDb } from '@/lib/db'
import { runAllScenarios } from '@/lib/scenarios'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * In memory, not a file: a serverless filesystem is read-only, so a scratch
 * file would work locally and fail in production — on the one button a
 * reviewer is most likely to press. It also means each run starts from nothing
 * without needing cleanup.
 */
const SCRATCH_DATABASE = ':memory:'

/**
 * One run at a time. The swap below is process-global, so two overlapping
 * requests would let the first run's cleanup hand the LIVE database back while
 * the second is still running — and a scenario begins by dropping every table.
 * Runs are seconds long, so queueing is cheaper than the failure it prevents.
 */
let running: Promise<unknown> = Promise.resolve()

export async function POST() {
  const ours = running.then(runOnce, runOnce)
  running = ours.catch(() => undefined)
  return ours
}

async function runOnce() {
  const liveDatabase = process.env.DATABASE_URL

  process.env.DATABASE_URL = SCRATCH_DATABASE
  closeDb()

  try {
    const results = await runAllScenarios()

    return NextResponse.json({
      ranAt: new Date().toISOString(),
      passed: results.every((result) => result.passed),
      results,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'The run failed.' },
      { status: 500 },
    )
  } finally {
    // Always hand the live database back, whatever happened above.
    if (liveDatabase === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = liveDatabase
    closeDb()
    freezeClock(null)
  }
}
