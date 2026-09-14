// Brings the items table in line with src/config/catalog.ts without dropping
// anything. This is the command to run after editing the catalogue — on a live
// call, or any other time — because a full reset is not needed to add a product
// and would throw away the recorded evidence to do it.

import { syncCatalog } from '@/lib/reset'
import { databaseUrl } from '@/lib/db'

async function main() {
  const { added, changed } = await syncCatalog()

  console.log(`Catalogue synced: ${databaseUrl()}`)
  console.log(added.length > 0 ? `  added:     ${added.join(', ')}` : '  added:     nothing new')
  console.log(
    changed.length > 0 ? `  updated:   ${changed.join(', ')}` : '  updated:   nothing changed',
  )
  console.log('')
  console.log('Reservations, drafts and recorded events are untouched.')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
