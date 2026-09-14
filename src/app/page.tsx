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

      {/* On a narrow screen the panel comes second, before the shelf: the thing
          you are meant to do should not sit below the catalogue. On a wide one
          it moves to the right and stays with you as the shelf scrolls. */}
      <div className="flex flex-col gap-8 py-10 lg:grid lg:grid-cols-[1fr_360px] lg:items-start lg:gap-10">
        <div className="order-1">
          <h1 className="text-4xl leading-[1.1] font-semibold tracking-tight sm:text-5xl">
            {BRAND.headline}
          </h1>
          <p className="mt-4 max-w-lg text-base text-text-muted">{BRAND.subheadline}</p>

          {/* The control lives on the panel, beside the orb it drives. A second
              identical button here would be two ways to do one thing. */}
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

        </div>

        <aside className="order-2 lg:order-none lg:sticky lg:top-8 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <VoicePanel session={session} />
        </aside>

        <div className="order-3 lg:col-start-1 lg:row-start-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-2.5">
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

/**
 * One soft shape rather than a row of bars. Every voice product converges on
 * this — a level meter reads as equipment, a single breathing form reads as
 * something listening — and the customer needs "is it hearing me?" answered at
 * a glance, not a signal reading.
 *
 * It is still driven by the real audio: the microphone while the customer
 * talks, the incoming stream while the agent answers. Thinking has no audio, so
 * it gets a slow pulse of its own rather than silence animated as if it were
 * sound. Written straight to the DOM each frame; putting this through React
 * would re-render the panel sixty times a second.
 */
function VoiceOrb({
  levelRef,
  state,
}: {
  levelRef: ReturnType<typeof useVoiceSession>['levelRef']
  state: ReturnType<typeof useVoiceSession>['state']
}) {
  const halo = useRef<HTMLSpanElement>(null)
  const core = useRef<HTMLSpanElement>(null)
  const stateRef = useRef(state)
  stateRef.current = state

  useEffect(() => {
    let frame = 0
    let phase = 0

    const tick = () => {
      frame = requestAnimationFrame(tick)
      phase += 0.055

      const current = stateRef.current
      const breathing = 0.5 + 0.5 * Math.sin(phase)

      const level =
        current === 'speaking'
          ? levelRef.current.output
          : current === 'listening'
            ? levelRef.current.input
            : 0

      const energy =
        current === 'thinking'
          ? 0.28 + 0.22 * breathing
          : current === 'idle' || current === 'connecting'
            ? 0.06 * breathing
            : Math.min(1, level * 8)

      if (core.current) {
        core.current.style.transform = `scale(${1 + energy * 0.22})`
      }
      if (halo.current) {
        halo.current.style.transform = `scale(${0.9 + energy * 0.75})`
        halo.current.style.opacity = String(0.18 + energy * 0.5)
      }
    }

    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [levelRef])

  // Warm even at rest: a grey orb reads as disabled, and this is the thing the
  // customer is meant to want to talk to.
  const live = state !== 'idle' && state !== 'connecting'
  const colour = live
    ? 'var(--accent)'
    : 'color-mix(in srgb, var(--accent) 38%, var(--surface-2))'

  return (
    <div className="relative flex h-28 items-center justify-center">
      <span
        ref={halo}
        aria-hidden="true"
        className="absolute h-20 w-20 rounded-full blur-2xl will-change-transform"
        style={{ background: colour, opacity: 0.2 }}
      />
      <span
        ref={core}
        aria-hidden="true"
        className="relative flex h-[68px] w-[68px] items-center justify-center rounded-full transition-colors duration-500 will-change-transform"
        style={{
          background: `radial-gradient(circle at 34% 28%, color-mix(in srgb, ${colour} 40%, white), ${colour} 70%, color-mix(in srgb, ${colour} 75%, black))`,
          boxShadow: `0 10px 30px -10px ${colour}`,
        }}
      >
        {!live && <span className="text-accent-fg/80"><MicIcon /></span>}
      </span>
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
      <div className="relative border-b border-border px-5 pt-4 pb-4">
        {lastLatency && (
          <span
            className="absolute top-4 right-5 font-mono text-xs text-text-muted"
            title="From the end of your turn to the agent's answer"
          >
            {lastLatency.turnEndToAnswerMs ?? lastLatency.turnEndToAudioMs} ms
          </span>
        )}
        {/* The orb is the control, not a picture of one: that is where the eye
            already is, and every voice product makes it clickable. */}
        <button
          type="button"
          onClick={session.isLive ? session.stop : session.start}
          aria-label={session.isLive ? BRAND.stopCta : BRAND.startCta}
          className="w-full cursor-pointer rounded-xl transition hover:opacity-90"
        >
          <VoiceOrb levelRef={session.levelRef} state={state} />
        </button>

        <p className="mt-1 text-center text-sm font-medium">{VOICE_STATE_COPY[state]}</p>

        <button
          type="button"
          onClick={session.isLive ? session.stop : session.start}
          className={`mt-3.5 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition ${
            session.isLive
              ? 'border border-border text-text-muted hover:bg-surface-2'
              : 'bg-accent text-accent-fg hover:opacity-90'
          }`}
        >
          {session.isLive ? (
            BRAND.stopCta
          ) : (
            <>
              <MicIcon />
              {BRAND.startCta}
            </>
          )}
        </button>
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
