// Rebuilds the database from schema.sql, then loads the catalogue and the
// seeded reservations.
// Invariant: this is the only code path that creates tables or seed rows, so
// every environment (dev, test, production) starts from an identical state.

import { readFileSync } from 'node:fs'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { CATALOG } from '@/config/catalog'
import { SEED_RESERVATIONS } from '@/config/seed'
import { databaseUrl, getDb } from './db'

const TABLES = ['events', 'drafts', 'reservations', 'items']

export type ResetOptions = {
  /**
   * Carry the events table across the rebuild. Events are the recorded
   * evidence — every latency sample and every token count on /review is
   * derived from them — and resetting the inventory is not a reason to lose
   * them. Tests want a clean slate and leave this false.
   */
  keepEvents?: boolean
}

export async function resetDatabase(options: ResetOptions = {}): Promise<void> {
  ensureLocalDirectory()

  const db = getDb()
  const schema = readFileSync(resolve(process.cwd(), 'src/lib/schema.sql'), 'utf8')

  // Read the events out before the drop and put them back after, rather than
  // skipping the drop: the schema is then rebuilt identically either way.
  const carried = options.keepEvents ? await readEvents(db) : []

  for (const table of TABLES) {
    await db.execute(`DROP TABLE IF EXISTS ${table}`)
  }
  await db.executeMultiple(schema)

  if (carried.length > 0) {
    await db.batch(
      carried.map((row) => ({
        sql: 'INSERT INTO events (session_id, ts, type, payload) VALUES (?, ?, ?, ?)',
        args: [row.session_id, row.ts, row.type, row.payload],
      })),
      'write',
    )
  }

  const createdAt = new Date().toISOString()

  await db.batch(
    [
      ...CATALOG.map((item) => ({
        sql: 'INSERT INTO items (id, name, total_stock) VALUES (?, ?, ?)',
        args: [item.id, item.name, item.totalStock],
      })),
      ...SEED_RESERVATIONS.map((reservation) => ({
        sql: `INSERT INTO reservations
                (id, item_id, quantity, start_date, end_date, status, source, draft_id, created_at)
              VALUES (?, ?, ?, ?, ?, 'confirmed', 'seed', NULL, ?)`,
        args: [
          reservation.id,
          reservation.itemId,
          reservation.quantity,
          reservation.startDate,
          reservation.endDate,
          createdAt,
        ],
      })),
    ],
    'write',
  )
}

type CarriedEvent = { session_id: string; ts: string; type: string; payload: string }

async function readEvents(db: ReturnType<typeof getDb>): Promise<CarriedEvent[]> {
  try {
    const result = await db.execute(
      'SELECT session_id, ts, type, payload FROM events ORDER BY id',
    )
    return result.rows as unknown as CarriedEvent[]
  } catch {
    // No events table yet — a first run, which has nothing to carry.
    return []
  }
}

/**
 * Bring the items table in line with the catalogue without touching anything
 * else. This is the safe move when the catalogue changes on a live call: a new
 * product needs a row in `items` before a booking can reference it, and a full
 * reset would throw away the recorded evidence just to get one.
 */
export async function syncCatalog(): Promise<{ added: string[]; changed: string[] }> {
  ensureLocalDirectory()

  const db = getDb()
  const existing = new Map(
    (
      await db.execute('SELECT id, name, total_stock FROM items')
    ).rows.map((row) => [
      String(row.id),
      { name: String(row.name), totalStock: Number(row.total_stock) },
    ]),
  )

  const added: string[] = []
  const changed: string[] = []

  for (const item of CATALOG) {
    const current = existing.get(item.id)
    if (!current) {
      await db.execute({
        sql: 'INSERT INTO items (id, name, total_stock) VALUES (?, ?, ?)',
        args: [item.id, item.name, item.totalStock],
      })
      added.push(item.name)
    } else if (current.name !== item.name || current.totalStock !== item.totalStock) {
      await db.execute({
        sql: 'UPDATE items SET name = ?, total_stock = ? WHERE id = ?',
        args: [item.name, item.totalStock, item.id],
      })
      changed.push(item.name)
    }
  }

  return { added, changed }
}

/** A `file:` database needs its directory to exist before libSQL opens it. */
function ensureLocalDirectory(): void {
  const url = databaseUrl()
  if (!url.startsWith('file:')) return

  const filePath = resolve(process.cwd(), url.slice('file:'.length))
  mkdirSync(dirname(filePath), { recursive: true })
}
