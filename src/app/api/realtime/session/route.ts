// Mints a short-lived client secret so the browser can open a WebRTC session
// without ever seeing the real API key.
//
// Invariant: the model, the instructions and the tool list are decided here, on
// the server, and baked into the token. A browser cannot widen what the agent
// is allowed to do by editing a request.

import { NextResponse } from 'next/server'

import { AGENT_CONFIG, buildSessionConfig } from '@/config/agent'
import { today } from '@/lib/clock'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CLIENT_SECRETS_URL = 'https://api.openai.com/v1/realtime/client_secrets'

export async function POST() {
  const apiKey = process.env.OPENAI_API_KEY

  if (!apiKey) {
    return NextResponse.json(
      { error: 'OPENAI_API_KEY is not set. Copy .env.example to .env and add it.' },
      { status: 500 },
    )
  }

  let response: Response
  try {
    response = await fetch(CLIENT_SECRETS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ session: buildSessionConfig(today()) }),
      cache: 'no-store',
    })
  } catch {
    return NextResponse.json({ error: 'Could not reach OpenAI.' }, { status: 502 })
  }

  const data: unknown = await response.json().catch(() => null)

  if (!response.ok) {
    // Surface the provider's own message, never the key that produced it.
    const message =
      (data as { error?: { message?: string } } | null)?.error?.message ??
      `OpenAI returned ${response.status}.`
    return NextResponse.json({ error: message }, { status: response.status })
  }

  const clientSecret = (data as { value?: string } | null)?.value
  if (!clientSecret) {
    return NextResponse.json(
      { error: 'OpenAI did not return a client secret.' },
      { status: 502 },
    )
  }

  return NextResponse.json({
    clientSecret,
    model: AGENT_CONFIG.model,
    vadSilenceMs: AGENT_CONFIG.turnDetection.silence_duration_ms,
  })
}
