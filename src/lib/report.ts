// Gathers everything measured from the recorded conversations: the database as
// it stands, the latency samples, and the cost computed from the token counts
// the API reported.
//
// Lives here rather than in the route so the reviewer page and the report
// generator cannot disagree — the figures in the documents are produced by this
// same function, not transcribed by hand from a page.

import { AGENT_CONFIG } from '@/config/agent'
import { CATALOG } from '@/config/catalog'
import { HOSTING, PRICING } from '@/config/pricing'
import { SEED_RESERVATIONS } from '@/config/seed'
import { listReservations } from './booking'
import { calculateCost, type RealtimeUsage } from './cost'
import { getDb } from './db'
import { summarise } from './metrics'
import { SCENARIOS } from './scenarios'

type ItemRow = {
  id: string
  name: string
  total_stock: number
}

type EventRow = {
  session_id: string
  ts: string
  type: string
  payload: string
}

export async function buildReport() {
  const [reservations, eventRows, itemRows] = await Promise.all([
    listReservations(),
    getDb()
      .execute('SELECT session_id, ts, type, payload FROM events ORDER BY id')
      .then((result) => result.rows as unknown as EventRow[]),
    getDb()
      .execute('SELECT id, name, total_stock FROM items ORDER BY id')
      .then((result) => result.rows as unknown as ItemRow[]),
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
    lookups: number
    followedInterruption: boolean
  }

  // How many database lookups a turn needed is also derived from the event
  // order rather than trusted from the browser: tool calls recorded between one
  // turn's latency sample and the next belong to that next turn. Deriving it
  // here rather than in the client is what lets sessions recorded before the
  // client counted correctly still be classified.
  const lookupsSinceLastTurn = new Map<string, number>()
  const allSamples: ClassifiedSample[] = []

  for (const row of eventRows) {
    if (row.type === 'tool_call') {
      const session = row.session_id
      lookupsSinceLastTurn.set(session, (lookupsSinceLastTurn.get(session) ?? 0) + 1)
      continue
    }
    if (row.type !== 'latency') continue

    const sample = JSON.parse(row.payload) as Record<string, unknown>
    const lookups = lookupsSinceLastTurn.get(row.session_id) ?? 0
    lookupsSinceLastTurn.set(row.session_id, 0)

    allSamples.push({
      ...sample,
      sessionId: row.session_id,
      lookups,
      followedInterruption:
        interruptedTurns.get(row.session_id)?.has(Number(sample.turn)) === true ||
        sample.clean === false,
    })
  }

  // Samples recorded before the measurement definition was corrected carry the
  // old field names. They are kept but excluded, and counted so the omission is
  // visible rather than silent.
  const current = allSamples.filter(
    (sample) => typeof sample.turnEndToAudioMs === 'number',
  )
  const superseded = allSamples.length - current.length
  const uninterrupted = current.filter((sample) => !sample.followedInterruption)
  const withLookup = current.filter((sample) => sample.lookups > 0)
  const withoutLookup = current.filter((sample) => sample.lookups === 0)

  const numbers = (samples: ClassifiedSample[], field: string): number[] =>
    samples.map((sample) => sample[field]).filter((v): v is number => typeof v === 'number')

  /**
   * A turn needed a lookup, but the browser that recorded it did not know that
   * — it closed the sample before the tool call was reported, so its "answer"
   * figure is really the acknowledgement. Those turns are excluded from the
   * answer statistics rather than quietly flattering them.
   */
  const answerMeasured = (sample: ClassifiedSample): boolean =>
    sample.lookups === 0 || Number(sample.toolCalls ?? 0) > 0

  const answerable = current.filter(answerMeasured)
  const answerNotMeasured = current.length - answerable.length

  /**
   * Audio cannot be heard before it is sent. A sample that claims otherwise was
   * recorded by a detector that caught the previous answer still playing out
   * after a barge-in, so it is dropped rather than allowed to pull the median
   * down. Counted, not hidden.
   */
  const audible = (samples: ClassifiedSample[]): number[] =>
    samples
      .filter(
        (sample) =>
          typeof sample.turnEndToAudibleMs === 'number' &&
          sample.turnEndToAudibleMs >= Number(sample.turnEndToAudioMs),
      )
      .map((sample) => Number(sample.turnEndToAudibleMs))

  const audibleDiscarded = numbers(current, 'turnEndToAudibleMs').length - audible(current).length

  const voiceMinutes = sessions
    .filter((session) => (session.counts.usage ?? 0) > 0)
    .reduce((total, session) => total + session.minutes, 0)

  return {
    agent: {
      model: AGENT_CONFIG.model,
      voice: AGENT_CONFIG.voice,
      turnDetection: AGENT_CONFIG.turnDetection,
      transcriptionModel: AGENT_CONFIG.transcriptionModel,
    },
    database: {
      // Read back from the items table, not from CATALOG: the section is
      // headed "Database", so a drift between the config file and what was
      // actually seeded has to be visible rather than papered over.
      items: itemRows.map((row) => ({
        id: row.id,
        name: row.name,
        totalStock: Number(row.total_stock),
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
        turnEndToAnswerMs:
          'To the audio carrying the actual answer. On a turn that needs a database lookup the agent now says "let me check" first, so the figure above becomes the time to that acknowledgement. This one is what did not improve, and both are reported so the acknowledgement cannot be mistaken for a speed-up.',
        followedInterruption:
          'The turn was spoken over the agent. The measurement is still valid — it is how fast the agent recovers — but it is reported separately, because interrupting changes what is being timed.',
        vadSilenceMs: AGENT_CONFIG.turnDetection.silence_duration_ms,
      },
      supersededSamples: superseded,
      totalTurns: current.length,
      uninterruptedTurns: uninterrupted.length,
      allTurns: {
        turnEndToAudio: summarise(current.map((s) => Number(s.turnEndToAudioMs))),
        turnEndToAudible: summarise(audible(current)),
        turnEndToAnswer: summarise(numbers(answerable, 'turnEndToAnswerMs')),
      },
      answerNotMeasured,
      audibleDiscarded,
      uninterrupted: {
        turnEndToAudio: summarise(uninterrupted.map((s) => Number(s.turnEndToAudioMs))),
        turnEndToAudible: summarise(audible(uninterrupted)),
        turnEndToAnswer: summarise(
          numbers(uninterrupted.filter(answerMeasured), 'turnEndToAnswerMs'),
        ),
      },
      // Split by whether the turn had to consult the database. This is where
      // the acknowledgement changes things, and where it does not.
      withLookup: {
        turns: withLookup.length,
        turnEndToAudio: summarise(withLookup.map((s) => Number(s.turnEndToAudioMs))),
        turnEndToAnswer: summarise(
          numbers(withLookup.filter(answerMeasured), 'turnEndToAnswerMs'),
        ),
      },
      withoutLookup: {
        turns: withoutLookup.length,
        turnEndToAudio: summarise(withoutLookup.map((s) => Number(s.turnEndToAudioMs))),
      },
      samples: current,
    },
    cost: {
      breakdown: calculateCost(usages, voiceMinutes),
      voiceMinutes,
      pricing: PRICING,
      hosting: HOSTING,
    },
    checks: { total: SCENARIOS.length },
  }
}
