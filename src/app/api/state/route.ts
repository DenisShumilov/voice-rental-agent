// A snapshot of everything the screen needs: the catalogue, the request
// currently under discussion, and the bookings on file.
// Read-only. Nothing here changes state.

import { NextResponse } from 'next/server'

import { CATALOG } from '@/config/catalog'
import { listReservations } from '@/lib/booking'
import { getDraftBySession } from '@/lib/drafts'
import { listEvents } from '@/lib/events'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const sessionId = new URL(request.url).searchParams.get('sessionId')

  const [draft, reservations, events] = await Promise.all([
    sessionId ? getDraftBySession(sessionId) : Promise.resolve(null),
    listReservations(),
    sessionId ? listEvents(sessionId) : Promise.resolve([]),
  ])

  // The confirmation token is the key to a booking. The screen never needs it —
  // the model receives it from the tool result — so it does not travel here.
  const { confirmationToken, ...publicDraft } = draft ?? {}
  const safeDraft = draft
    ? { ...publicDraft, awaitingConfirmation: confirmationToken !== null }
    : null

  return NextResponse.json({
    items: CATALOG.map((item) => ({
      id: item.id,
      sku: item.sku,
      name: item.name,
      subtitle: item.subtitle,
      specs: item.specs,
      pricePerDay: item.pricePerDay,
      totalStock: item.totalStock,
    })),
    draft: safeDraft,
    reservations,
    events,
  })
}
