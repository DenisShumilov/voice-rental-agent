// `npm run reset-db` — wipes the database and reloads catalogue + seed data.

import { CATALOG } from '@/config/catalog'
import { SEED_RESERVATIONS } from '@/config/seed'
import { closeDb } from '@/lib/db'
import { resetDatabase } from '@/lib/reset'

async function main() {
  await resetDatabase()

  console.log(`Database reset: ${process.env.DATABASE_URL ?? 'file:./data/rental.db'}`)
  console.log('')
  console.log('Catalogue')
  for (const item of CATALOG) {
    console.log(`  ${item.name.padEnd(14)} ${item.totalStock} units`)
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
