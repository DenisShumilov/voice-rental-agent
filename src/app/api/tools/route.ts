// The single entry point through which the voice agent reaches the booking
// system. The browser relays the model's tool call here; the decision is made
// on this side of the wire, never in the browser.

import { NextResponse } from 'next/server'
import { z } from 'zod'

import { dispatchTool } from '@/lib/tools'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const requestBody = z.object({
  sessionId: z.string().min(1),
  tool: z.string().min(1),
  args: z.unknown().optional(),
})

export async function POST(request: Request) {
  const json = await request.json().catch(() => null)
  const parsed = requestBody.safeParse(json)

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Expected a body of { sessionId, tool, args }.' },
      { status: 400 },
    )
  }

  const result = await dispatchTool(
    parsed.data.sessionId,
    parsed.data.tool,
    parsed.data.args ?? {},
  )

  return NextResponse.json(result)
}
