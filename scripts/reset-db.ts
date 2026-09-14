// `npm run reset-db` — wipes the database and reloads catalogue + seed data.

import { CATALOG } from '@/config/catalog'
import { SEED_RESERVATIONS } from '@/config/seed'
import { closeDb } from '@/lib/db'
import { databaseUrl } from '@/lib/db'
import { resetDatabase } from '@/lib/reset'

async function main() {
  // Events are the recorded evidence behind every figure on /review. Resetting
  // the inventory is not a reason to lose them, so they survive by default and
  // go only when someone asks for that in as many words.
  const wipeEvents = process.argv.includes('--wipe-events')
  await resetDatabase({ keepEvents: !wipeEvents })

  console.log(`Database reset: ${databaseUrl()}`)
  console.log(
    wipeEvents
      ? '  events:    wiped (--wipe-events)'
      : '  events:    kept — latency and cost evidence survives',
  )
  console.log('')
  console.log('Catalogue')
  for (const item of CATALOG) {
    console.log(`  ${item.name.padEnd(14)} ${item.totalStock} ${item.totalStock === 1 ? 'unit' : 'units'}`)
  }
  console.log('')
  console.log('Seeded reservations')
  for (const reservation of SEED_RESERVATIONS) {
    console.log(
      `  ${reservation.itemId.padEnd(10)} x${reservation.quantity}  ` +
        `${reservation.startDate} to ${reservation.endDate} (inclusive)`,
    )
  }

  closeDb()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
