// Everything the reviewer page shows about what has actually happened: the
// database as it stands, every recorded conversation, the latency samples and
// the cost computed from real token counts.
//
// Read-only. No secrets: prices and model names are public, and confirmation
// tokens never leave the server.

import { NextResponse } from 'next/server'

import { AGENT_CONFIG } from '@/config/agent'
import { CATALOG } from '@/config/catalog'
import { HOSTING, PRICING } from '@/config/pricing'
import { SEED_RESERVATIONS } from '@/config/seed'
import { listReservations } from '@/lib/booking'
import { calculateCost, type RealtimeUsage } from '@/lib/cost'
import { getDb } from '@/lib/db'
import { summarise } from '@/lib/metrics'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type EventRow = {
  session_id: string
  ts: string
  type: string
  payload: string
}

export async function GET() {
  const [reservations, eventRows] = await Promise.all([
    listReservations(),
    getDb()
      .execute('SELECT session_id, ts, type, payload FROM events ORDER BY id')
      .then((result) => result.rows as unknown as EventRow[]),
  ])

  const bySession = new Map<string, EventRow[]>()
  for (const row of eventRows) {
    const list = bySession.get(row.session_id) ?? []
    list.push(row)
    bySession.set(row.session_id, list)
  }

  const sessions = [...bySession.entries()]
    .map(([id, rows]) => {
      const startedAt = rows[0].ts
      const endedAt = rows[rows.length - 1].ts
      const counts: Record<string, number> = {}
      for (const row of rows) counts[row.type] = (counts[row.type] ?? 0) + 1

      return {
        id,
        startedAt,
        endedAt,
        minutes:
          (new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 60_000,
        counts,
      }
    })
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))

  const parse = <T,>(rows: EventRow[], type: string): T[] =>
    rows.filter((row) => row.type === type).map((row) => JSON.parse(row.payload) as T)

  const usages = parse<RealtimeUsage>(eventRows, 'usage')

  // Which turns followed the customer talking over the agent is derived here,
  // from the recorded barge-ins, rather than trusted from the browser's own
  // flag: a barge-in is logged against the turn being interrupted, so the turn
  // AFTER it is the interrupting one. Deriving it server-side also classifies
  // sessions recorded before the browser got this right.
  const interruptedTurns = new Map<string, Set<number>>()
  for (const row of eventRows) {
    if (row.type !== 'barge_in') continue
    const payload = JSON.parse(row.payload) as { turn?: number }
    if (typeof payload.turn !== 'number') continue
    const set = interruptedTurns.get(row.session_id) ?? new Set<number>()
    set.add(payload.turn + 1)
    interruptedTurns.set(row.session_id, set)
  }

  type ClassifiedSample = Record<string, unknown> & {
    sessionId: string
    followedInterruption: boolean
  }

  const allSamples: ClassifiedSample[] = eventRows
    .filter((row) => row.type === 'latency')
    .map((row) => {
      const sample = JSON.parse(row.payload) as Record<string, unknown>
      return {
        ...sample,
        sessionId: row.session_id,
        followedInterruption:
          interruptedTurns.get(row.session_id)?.has(Number(sample.turn)) === true ||
          sample.clean === false,
      }
    })

  // Samples recorded before the measurement definition was corrected carry the
  // old field names. They are kept but excluded, and counted so the omission is
  // visible rather than silent.
  const current = allSamples.filter(
    (sample) => typeof sample.turnEndToAudioMs === 'number',
  )
  const superseded = allSamples.length - current.length
  const uninterrupted = current.filter((sample) => !sample.followedInterruption)

  const voiceMinutes = sessions
    .filter((session) => (session.counts.usage ?? 0) > 0)
    .reduce((total, session) => total + session.minutes, 0)

  return NextResponse.json({
    agent: {
      model: AGENT_CONFIG.model,
      voice: AGENT_CONFIG.voice,
      turnDetection: AGENT_CONFIG.turnDetection,
      transcriptionModel: AGENT_CONFIG.transcriptionModel,
    },
    database: {
      items: CATALOG.map((item) => ({
        id: item.id,
        sku: item.sku,
        name: item.name,
        totalStock: item.totalStock,
      })),
      seeded: SEED_RESERVATIONS,
      reservations,
    },
    sessions,
    latency: {
      definition: {
        turnEndToAudioMs:
          'From the moment the customer stopped speaking to the moment the server began sending audio. Server VAD only reports the turn as ended after a full silence window, so that window is added back rather than subtracted.',
        turnEndToAudibleMs:
          'The same, measured to the first frame loud enough to hear, plus the output device latency reported by the browser.',
        followedInterruption:
          'The turn was spoken over the agent. The measurement is still valid — it is how fast the agent recovers — but it is reported separately, because interrupting changes what is being timed.',
        vadSilenceMs: AGENT_CONFIG.turnDetection.silence_duration_ms,
      },
      supersededSamples: superseded,
      totalTurns: current.length,
      uninterruptedTurns: uninterrupted.length,
      allTurns: {
        turnEndToAudio: summarise(current.map((s) => Number(s.turnEndToAudioMs))),
        turnEndToAudible: summarise(
          current
            .map((s) => s.turnEndToAudibleMs)
            .filter((value): value is number => typeof value === 'number'),
        ),
      },
      uninterrupted: {
        turnEndToAudio: summarise(uninterrupted.map((s) => Number(s.turnEndToAudioMs))),
        turnEndToAudible: summarise(
          uninterrupted
            .map((s) => s.turnEndToAudibleMs)
            .filter((value): value is number => typeof value === 'number'),
        ),
      },
      samples: current,
    },
    cost: {
      breakdown: calculateCost(usages, voiceMinutes),
      voiceMinutes,
      pricing: PRICING,
      hosting: HOSTING,
    },
    events: eventRows.map((row) => ({
      sessionId: row.session_id,
      ts: row.ts,
      type: row.type,
      payload: JSON.parse(row.payload) as unknown,
    })),
  })
}
