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

const SCRATCH_DATABASE = 'file:./data/review-run.db'

export async function POST() {
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
