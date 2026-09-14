// Append-only record of what happened in a conversation: draft changes, tool
// results, booking outcomes, barge-ins and latency marks.
// Invariant: events are evidence, never state. Nothing reads them to decide
// anything — they exist so the reviewer page can show what occurred.

import { getDb, type SqlExecutor } from './db'

export type EventType =
  | 'draft_updated'
  | 'booking_confirmed'
  | 'booking_rejected'
  | 'booking_replayed'
  | 'tool_call'
  | 'tool_result'
  | 'barge_in'
  | 'latency'
  | 'usage'

export type EventRecord = {
  id: number
  sessionId: string
  ts: string
  type: EventType
  payload: unknown
}

export async function logEvent(
  sessionId: string,
  type: EventType,
  payload: unknown,
  executor: SqlExecutor = getDb(),
): Promise<void> {
  await executor.execute({
    sql: 'INSERT INTO events (session_id, ts, type, payload) VALUES (?, ?, ?, ?)',
    args: [sessionId, new Date().toISOString(), type, JSON.stringify(payload ?? null)],
  })
}

export async function listEvents(sessionId: string): Promise<EventRecord[]> {
  const result = await getDb().execute({
    sql: 'SELECT id, session_id, ts, type, payload FROM events WHERE session_id = ? ORDER BY id',
    args: [sessionId],
  })

  return result.rows.map((row) => ({
    id: Number(row.id),
    sessionId: String(row.session_id),
    ts: String(row.ts),
    type: String(row.type) as EventType,
    payload: JSON.parse(String(row.payload)) as unknown,
  }))
}
