'use client'

// The storefront. The only way to book here is to speak; there is no form.
//
// Two rules shape the layout. Merchandising and transaction are kept apart: the
// cards are a shelf, and the docked panel owns dates, quantity, confirmation.
// And everything shown about availability comes from a tool result or a server
// lookup — never from the model's own words.

import Image from 'next/image'
import { useEffect, useRef, useState } from 'react'

import { BRAND, TRUST_FACTS, VOICE_STATE_COPY, exampleUtterance } from '@/config/brand'
import { CATALOG } from '@/config/catalog'
import { useVoiceSession } from '@/voice/use-voice-session'

type ShelfItem = {
  id: string
  sku: string
  name: string
  subtitle: string
  specs: string
  pricePerDay: number
  image: string | null
  totalStock: number
  availableForDates: number | null
}

const INITIAL_SHELF: ShelfItem[] = CATALOG.map((item) => ({
  id: item.id,
  sku: item.sku,
  name: item.name,
  subtitle: item.subtitle,
  specs: item.specs,
  pricePerDay: item.pricePerDay,
  image: item.image ?? null,
  totalStock: item.totalStock,
  availableForDates: null,
}))

export default function StorefrontPage() {
  const session = useVoiceSession()
  const [shelf, setShelf] = useState<ShelfItem[]>(INITIAL_SHELF)

  const startDate = session.request?.startDate ?? session.booking?.startDate ?? null
  const endDate = session.request?.endDate ?? session.booking?.endDate ?? null

  // When the conversation settles on dates, the shelf re-answers for those
  // dates. This is the moment the page stops being a brochure.
  useEffect(() => {
    let cancelled = false
    const query = startDate && endDate ? `?start=${startDate}&end=${endDate}` : ''

    fetch(`/api/state${query}`, { cache: 'no-store' })
      .then((response) => response.json())
      .then((data: { items: ShelfItem[] }) => {
        if (!cancelled) setShelf(data.items)
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [startDate, endDate, session.booking?.reference])

  return (
    <main className="mx-auto max-w-6xl px-5 py-8 lg:px-8">
      <header className="flex items-baseline justify-between border-b border-border pb-5">
        <span className="text-lg font-semibold tracking-tight">{BRAND.name}</span>
        <a href="/review" className="text-sm text-text-muted underline-offset-4 hover:underline">
          Reviewer view
        </a>
      </header>

      <div className="grid gap-8 py-10 lg:grid-cols-[1fr_360px] lg:gap-10">
        <div>
          <h1 className="text-4xl leading-[1.1] font-semibold tracking-tight sm:text-5xl">
            {BRAND.headline}
          </h1>
          <p className="mt-4 max-w-lg text-base text-text-muted">{BRAND.subheadline}</p>

          <button
            type="button"
            onClick={session.isLive ? session.stop : session.start}
            className="mt-7 inline-flex items-center gap-2.5 rounded-xl bg-accent px-6 py-3.5 text-base font-medium text-accent-fg transition hover:opacity-90"
          >
            <MicIcon />
            {session.isLive ? BRAND.stopCta : BRAND.startCta}
          </button>

          <ul className="mt-7 grid gap-2 border-t border-border pt-5 text-sm text-text-muted sm:grid-cols-3">
            {TRUST_FACTS.map((fact) => (
              <li key={fact}>{fact}</li>
            ))}
          </ul>

          {session.error && (
            <p className="mt-5 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-warn">
              {session.error}
            </p>
          )}

          <div className="mt-10 flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-2.5">
            <h2 className="text-sm font-medium tracking-wide text-text-muted uppercase">
              {BRAND.shelfHeading}
            </h2>
            <p className="font-mono text-xs text-text-muted">
              {startDate && endDate ? (
                <>
                  {startDate} → {endDate}
                  <span className="ml-2 font-sans">· change the dates by voice</span>
                </>
              ) : (
                <span className="font-sans">any dates — just say when</span>
              )}
            </p>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            {shelf.map((item) => (
              <ProductCard key={item.id} item={item} hasDates={Boolean(startDate && endDate)} />
            ))}
          </div>
        </div>

        <aside className="lg:sticky lg:top-8 lg:self-start">
          <VoicePanel session={session} />
        </aside>
      </div>
    </main>
  )
}

function ProductCard({ item, hasDates }: { item: ShelfItem; hasDates: boolean }) {
  const free = item.availableForDates
  const soldOut = hasDates && free === 0
  // A missing photograph falls back to the SKU tile rather than a broken image.
  const [imageFailed, setImageFailed] = useState(false)

  return (
    <article className="flex flex-col overflow-hidden rounded-[var(--radius)] border border-border bg-surface">
      <div className="relative aspect-[4/3] bg-surface-2">
        {item.image && !imageFailed ? (
          // next/image rather than a plain tag: the source photographs are
          // around 1.5 MB each, and this serves a resized, modern-format
          // version sized to the card instead.
          <Image
            src={item.image}
            alt={item.subtitle}
            fill
            sizes="(min-width: 640px) 33vw, 100vw"
            onError={() => setImageFailed(true)}
            className="object-cover"
          />
        ) : (
          <span className="absolute inset-0 flex items-center justify-center font-mono text-2xl tracking-[0.2em] text-text-muted/40">
            {item.sku}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col p-4">
        <p className="font-mono text-[11px] tracking-wider text-text-muted">{item.sku}</p>
        <h3 className="mt-1.5 font-medium">{item.name}</h3>
        <p className="text-sm text-text-muted">{item.subtitle}</p>
        <p className="mt-0.5 text-xs text-text-muted">{item.specs}</p>

        <div className="mt-4 flex items-baseline justify-between border-t border-border pt-3">
          <span className="font-mono text-sm">
            ${item.pricePerDay}
            <span className="text-text-muted"> /day</span>
          </span>
          <span
            className={`text-xs ${soldOut ? 'text-warn' : hasDates ? 'text-ok' : 'text-text-muted'}`}
          >
            {hasDates && free !== null
              ? free === 0
                ? 'None free'
                : `${free} free`
              : `${item.totalStock} in stock`}
          </span>
        </div>
      </div>
    </article>
  )
}

const BAR_COUNT = 28

/**
 * A meter driven by the actual audio, not an animation pretending to be one:
 * the bars follow the microphone while the customer talks and the incoming
 * stream while the agent answers. It writes heights straight to the DOM on each
 * frame, because re-rendering React sixty times a second to move 28 bars would
 * make the rest of the page stutter.
 */
function VoiceMeter({
  levelRef,
  state,
}: {
  levelRef: ReturnType<typeof useVoiceSession>['levelRef']
  state: ReturnType<typeof useVoiceSession>['state']
}) {
  const bars = useRef<Array<HTMLSpanElement | null>>([])
  const stateRef = useRef(state)
  stateRef.current = state

  useEffect(() => {
    let frame = 0
    let phase = 0

    const tick = () => {
      frame = requestAnimationFrame(tick)
      phase += 0.09

      const current = stateRef.current
      const level =
        current === 'speaking'
          ? levelRef.current.output
          : current === 'listening'
            ? levelRef.current.input
            : 0

      bars.current.forEach((bar, index) => {
        if (!bar) return
        const offset = Math.sin(phase + index * 0.55)
        // Thinking has no audio to show, so it gets an explicit travelling
        // pulse — a waiting indicator, never dressed up as sound.
        const height =
          current === 'thinking'
            ? 14 + 10 * Math.max(0, Math.sin(phase * 1.6 - index * 0.4))
            : 4 + Math.min(1, level * 9) * 34 * (0.55 + 0.45 * offset * offset)
        bar.style.height = `${Math.max(3, height)}px`
      })
    }

    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [levelRef])

  const tone =
    state === 'idle' || state === 'connecting'
      ? 'bg-[var(--text-muted)]/25'
      : state === 'thinking'
        ? 'bg-[var(--text-muted)]/50'
        : 'bg-accent'

  return (
    <div className="flex h-12 items-center justify-center gap-[3px]" aria-hidden="true">
      {Array.from({ length: BAR_COUNT }, (_, index) => (
        <span
          key={index}
          ref={(node) => {
            bars.current[index] = node
          }}
          className={`w-[3px] rounded-full transition-colors ${tone}`}
          style={{ height: '3px' }}
        />
      ))}
    </div>
  )
}

function Bubble({ entry }: { entry: { role: 'user' | 'assistant'; text: string } }) {
  const fromCustomer = entry.role === 'user'
  return (
    <div className={`flex ${fromCustomer ? 'justify-end' : 'justify-start'}`}>
      <p
        className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
          fromCustomer
            ? 'rounded-br-sm bg-accent text-accent-fg'
            : 'rounded-bl-sm bg-surface-2 text-text'
        }`}
      >
        {entry.text}
      </p>
    </div>
  )
}

function VoicePanel({ session }: { session: ReturnType<typeof useVoiceSession> }) {
  const { state, request, bookings, transcript, latency } = session
  // A request in progress takes the card; a booking made earlier in the same
  // conversation moves to the list below rather than disappearing.
  const booking = request === null ? (bookings.at(-1) ?? null) : null
  const earlier = request === null ? bookings.slice(0, -1) : bookings
  // Only uninterrupted turns are shown: a barged-in turn times a cancelled
  // answer, not how fast the agent replies.
  const lastLatency = latency.filter((sample) => sample.clean).at(-1)

  // The transcript grows while the customer is talking, not scrolling. Without
  // this the newest line is the one they cannot see.
  const transcriptEnd = useRef<HTMLDivElement>(null)
  useEffect(() => {
    transcriptEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [transcript.length])

  return (
    <div className="flex max-h-[calc(100vh-6rem)] flex-col overflow-hidden rounded-[var(--radius)] border border-border bg-surface">
      <div className="flex items-center gap-2.5 border-b border-border px-5 py-3.5">
        <span
          className={`inline-block h-2.5 w-2.5 rounded-full ${
            state === 'idle' ? 'bg-[var(--text-muted)]' : 'status-dot-live bg-accent'
          }`}
        />
        <span className="text-sm font-medium">{VOICE_STATE_COPY[state]}</span>
        {lastLatency && (
          <span
            className="ml-auto font-mono text-xs text-text-muted"
            title="Time from the end of your turn to the agent's answer"
          >
            {lastLatency.turnEndToAnswerMs ?? lastLatency.turnEndToAudioMs} ms
          </span>
        )}
      </div>

      <div className="border-b border-border px-5 py-2">
        <VoiceMeter levelRef={session.levelRef} state={state} />
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">

      {booking ? (
        <div className="rounded-lg border border-[var(--ok)] bg-surface-2 p-4">
          <p className="text-xs font-medium tracking-wide text-ok uppercase">Booking confirmed</p>
          <p className="mt-2 text-lg font-medium">
            {booking.item} ×{booking.quantity}
          </p>
          <p className="font-mono text-sm text-text-muted">
            {booking.startDate} → {booking.endDate}
          </p>
          {booking.remaining !== null && (
            <p className="mt-2 text-sm text-text-muted">
              {booking.remaining} left for those dates
            </p>
          )}
          <p className="mt-3 font-mono text-[11px] text-text-muted">
            Reference {booking.reference.slice(0, 8)}
          </p>
        </div>
      ) : request ? (
        <div className="rounded-lg border border-border bg-surface-2 p-4">
          <p className="text-xs font-medium tracking-wide text-text-muted uppercase">
            Current request
          </p>
          <p className="mt-2 text-lg font-medium">
            {request.item ?? 'Which item?'}
            {request.quantity ? ` ×${request.quantity}` : ''}
          </p>
          <p className="font-mono text-sm text-text-muted">
            {request.startDate && request.endDate
              ? `${request.startDate} → ${request.endDate}`
              : 'Which dates?'}
          </p>
          <p className="mt-3 text-sm">
            {request.status === 'available' && (
              <span className="text-ok">
                Available — {request.available} of {request.totalStock} free. Awaiting your
                confirmation.
              </span>
            )}
            {request.status === 'unavailable' && (
              <span className="text-warn">
                Not available — only {request.available} of {request.totalStock} free.
              </span>
            )}
            {request.status === 'needs_clarification' && (
              <span className="text-text-muted">The agent needs a little more detail.</span>
            )}
          </p>
        </div>
      ) : (
        <p className="text-sm text-text-muted">
          Say what you need and when. For example: &ldquo;{exampleUtterance(CATALOG[0].name)}&rdquo;
        </p>
      )}

      {earlier.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-border pt-3">
          {earlier.map((made) => (
            <li key={made.reference} className="text-xs text-text-muted">
              <span className="text-ok">✓</span> {made.item} ×{made.quantity}{' '}
              <span className="font-mono">
                {made.startDate} → {made.endDate}
              </span>
            </li>
          ))}
        </ul>
      )}

        {transcript.length > 0 && (
          <div className="mt-4 space-y-2 border-t border-border pt-4">
            {transcript.map((entry, index) => (
              <Bubble key={index} entry={entry} />
            ))}
            <div ref={transcriptEnd} />
          </div>
        )}
      </div>

      <div className="border-t border-border px-5 py-3.5">
        {session.isLive ? (
          <button
            type="button"
            onClick={session.stop}
            className="w-full rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-text-muted transition hover:bg-surface-2"
          >
            {BRAND.stopCta}
          </button>
        ) : (
          // No second microphone button: the hero already owns that action, and
          // two identical buttons side by side read as a mistake.
          <p className="text-center text-xs text-text-muted">
            Press <span className="font-medium text-text">{BRAND.startCta}</span> to begin
          </p>
        )}
      </div>
    </div>
  )
}

function MicIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M19 12a7 7 0 0 1-14 0M12 19v3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  )
}
