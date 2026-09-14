// A snapshot of everything the screen needs: the catalogue, the request
// currently under discussion, and the bookings on file.
// Read-only. Nothing here changes state.

import { NextResponse } from 'next/server'

import { CATALOG } from '@/config/catalog'
import { getAvailability, isCalendarDate } from '@/lib/availability'
import { listReservations } from '@/lib/booking'
import { getDraftBySession } from '@/lib/drafts'
import { listEvents } from '@/lib/events'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const sessionId = params.get('sessionId')
  const startDate = params.get('start')
  const endDate = params.get('end')

  // When the conversation has settled on dates, the shelf answers for those
  // dates rather than quoting total stock — the catalogue reacts to what was
  // said out loud.
  const availability =
    startDate && endDate && isCalendarDate(startDate) && isCalendarDate(endDate)
      ? await Promise.all(
          CATALOG.map((item) =>
            getAvailability(item.id, startDate, endDate).catch(() => null),
          ),
        )
      : null

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
    dates: availability ? { startDate, endDate } : null,
    items: CATALOG.map((item, index) => ({
      id: item.id,
      name: item.name,
      image: item.image ?? null,
      totalStock: item.totalStock,
      availableForDates: availability?.[index]?.available ?? null,
    })),
    draft: safeDraft,
    reservations,
    events,
  })
}
