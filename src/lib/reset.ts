// Rebuilds the database from schema.sql, then loads the catalogue and the
// seeded reservations.
// Invariant: this is the only code path that creates tables or seed rows, so
// every environment (dev, test, production) starts from an identical state.

import { readFileSync } from 'node:fs'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { CATALOG } from '@/config/catalog'
import { SEED_RESERVATIONS } from '@/config/seed'
import { getDb } from './db'

const TABLES = ['events', 'drafts', 'reservations', 'items']

export async function resetDatabase(): Promise<void> {
  ensureLocalDirectory()

  const db = getDb()
  const schema = readFileSync(resolve(process.cwd(), 'src/lib/schema.sql'), 'utf8')

  for (const table of TABLES) {
    await db.execute(`DROP TABLE IF EXISTS ${table}`)
  }
  await db.executeMultiple(schema)

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

/** A `file:` database needs its directory to exist before libSQL opens it. */
function ensureLocalDirectory(): void {
  const url = process.env.DATABASE_URL ?? 'file:./data/rental.db'
  if (!url.startsWith('file:')) return

  const filePath = resolve(process.cwd(), url.slice('file:'.length))
  mkdirSync(dirname(filePath), { recursive: true })
}
