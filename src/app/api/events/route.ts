// Records things only the browser can observe: what was said, when the customer
// interrupted, how long the agent took to answer, and what the session cost.
//
// These are evidence, not state. Nothing in the booking logic reads them.

import { NextResponse } from 'next/server'
import { z } from 'zod'

import { logEvent, type EventType } from '@/lib/events'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const RECORDABLE: EventType[] = ['barge_in', 'latency', 'usage']

const requestBody = z.object({
  sessionId: z.string().min(1),
  type: z.string().min(1),
  payload: z.unknown().optional(),
})

export async function POST(request: Request) {
  const parsed = requestBody.safeParse(await request.json().catch(() => null))

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Expected a body of { sessionId, type, payload }.' },
      { status: 400 },
    )
  }

  const type = parsed.data.type as EventType
  if (!RECORDABLE.includes(type)) {
    return NextResponse.json(
      { error: `Only ${RECORDABLE.join(', ')} may be recorded from the browser.` },
      { status: 400 },
    )
  }

  await logEvent(parsed.data.sessionId, type, parsed.data.payload ?? null)
  return NextResponse.json({ recorded: true })
}
