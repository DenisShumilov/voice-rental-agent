// Opens the one libSQL connection the whole app shares.
// Invariant: the connection is created lazily, so tests can point
// DATABASE_URL at a scratch file before the first query is issued.

import {
  createClient,
  type Client,
  type InStatement,
  type ResultSet,
} from '@libsql/client'

/**
 * Anything that can run a statement: the pooled client, or an open
 * transaction. Reads that must see uncommitted writes take one of these so the
 * caller decides which.
 */
export type SqlExecutor = {
  execute(statement: InStatement): Promise<ResultSet>
}

const DEFAULT_URL = 'file:./data/rental.db'

let client: Client | undefined
let openedWith: string | undefined

export function getDb(): Client {
  // `??` is not enough: a key left blank in .env is an empty string, not
  // undefined, and libSQL rejects '' as a malformed URL.
  const url = process.env.DATABASE_URL?.trim() || DEFAULT_URL

  // Reopen if the target moved (tests switch to a scratch database).
  if (client && openedWith !== url) {
    client.close()
    client = undefined
  }

  if (!client) {
    client = createClient({
      url,
      authToken: process.env.DATABASE_AUTH_TOKEN?.trim() || undefined,
    })
    openedWith = url
  }

  return client
}

/** True when a write lost to a UNIQUE constraint rather than failing outright. */
export function isUniqueViolation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('UNIQUE constraint failed')
}

export function closeDb(): void {
  client?.close()
  client = undefined
  openedWith = undefined
}
