# CLAUDE.md

Rules for anyone — human or AI — working in this repository.
Read this before writing a single line.

---

## What this is

A browser voice agent for a three-item equipment rental desk. The customer
speaks; the agent listens, checks real availability, asks for confirmation,
and saves exactly one reservation.

- `/` — customer storefront (the only place a booking is made)
- `/review` — evidence page for the reviewer (tests, DB state, latency, cost)

---

## The one law

> **The model speaks. The database decides.**

The language model may: understand speech, ask clarifying questions, call tools,
and read tool results aloud.

The language model may **never** decide:
- whether stock is available
- whether a booking is allowed
- whether a confirmation is still valid
- whether a reservation already exists

Any code where the model's output determines one of those is a bug, not a style
preference.

---

## Core invariants

A reservation row is written **only** when all four gates pass:

1. The confirmation token matches the draft's current token.
2. The version in the call matches the draft's current version.
3. The draft status is `available`.
4. Inside a transaction, availability is recomputed and `UNIQUE(draft_id)` holds.

A confirmation token is issued **only** alongside status `available`. The model
therefore cannot confirm an unavailable, incomplete, or ambiguous request — it
has no key to do so.

Every `set_request` call bumps `version` and rotates `confirmation_token`. Any
token from an earlier version is dead.

**Availability is the minimum free units across every day of the inclusive
range.** For each day, sum the quantity of confirmed reservations covering that
day; take the maximum of those daily sums; subtract from total stock.
Do **not** sum all reservations overlapping the range — that double-counts
reservations that do not overlap each other.

---

## One thing, one place

Everything that may need changing lives in exactly one file.

| What | Only file |
|---|---|
| Items, stock, name aliases, photographs | `src/config/catalog.ts` |
| Seeded reservations | `src/config/seed.ts` |
| Rental limits and defaults | `src/config/rules.ts` |
| Model, voice, prompt, turn detection | `src/config/agent.ts` |
| Provider prices for the cost calculator | `src/config/pricing.ts` |
| The name on the page and every word of page copy | `src/config/copy.ts` |

Hardcoding an item name, a seed date, a rental limit, a model ID, a price, or
a line of page copy anywhere else is forbidden. Tests are the only exception, and
even there prefer reading the value from its config file so a live change to
the catalogue does not break the suite.

Enforced by `npm run doctor`.

---

## Conventions

- File names: lowercase, hyphenated — `draft-state.ts`
- Folder names: one lowercase word — `lib`, `config`, `voice`
- Function names: verb + object — `getAvailability`, `confirmBooking`
- Every file in `src/lib/` opens with a two-line comment: what it does, and
  which invariant it holds
- No `utils.ts`, `helpers.ts`, `misc.ts`, `common.ts`
- No commented-out code, no `TODO`, no stray `console.log`
- English everywhere: code, comments, docs, commit messages, on-screen copy

---

## Architecture

```
Browser ──WebRTC audio──▶ OpenAI Realtime (gpt-realtime-2.1-mini)
   │                              │
   │                       function call
   │                              ▼
   └── POST /api/tools ──▶ Next.js server ──▶ SQLite (libSQL)
                                                   ▲
                                          the only source of truth
```

The browser is a transport, not an authority. Tool calls are executed
server-side; the browser only relays the request and the result.

Three tools, and only three:

| Tool | Effect |
|---|---|
| `set_request` | create or update the draft, recheck availability, rotate token |
| `confirm_booking` | run the four gates, write at most one reservation |
| `check_availability` | read-only lookup, never writes |

---

## Deprecated model IDs — never use

`gpt-realtime`, `gpt-realtime-mini`, `gpt-4o-realtime-preview`,
`gpt-4o-mini-realtime-preview` — all shut down 20 January 2027.

Current: **`gpt-realtime-2.1-mini`** (audio in $10 / audio out $20 per 1M tokens).

Turn detection is `server_vad` with an explicit `silence_duration_ms: 500`, so
the detection delay is a known constant that can be honestly added back.

---

## Latency measurement

Three figures are reported, never one:

| Figure | Definition |
|---|---|
| Turn end → any audio | arrival of `input_audio_buffer.speech_stopped` to arrival of `output_audio_buffer.started`, PLUS `silence_duration_ms` — server VAD only reports the turn ended after hearing the full window, so it is added back, never subtracted |
| Turn end → audible | the same, to the first non-silent frame on the remote track, plus `AudioContext.outputLatency` |
| Turn end → the answer | on a turn with a database lookup, to the audio that carries the answer rather than the acknowledgement |

Never report a latency number that was not measured. Never round a measurement
into a promise. The timing logic lives in `src/voice/turn-timer.ts`, free of
browser APIs, and is covered by replayable tests — change it there, not in the
WebRTC client.

---

## Cost

Token counts come from `response.usage` on `response.done` — actual audio,
text, and cached token counts. Multiply by the prices in `config/pricing.ts`,
each of which carries a source URL comment.

Never estimate a per-minute cost that was not computed from measured usage.
Hosting cost is reported separately from API cost. Free credits are valued at
list price.

---

## Before saying anything is done

```bash
npm run check     # typecheck + tests + doctor
```

Red means not done. There are no exceptions to this.

---

## Out of scope — do not add

Accounts, authentication, payments, real rental integrations, external CRM,
agent frameworks, Docker, Redis, queues, a second language, a fourth product,
elaborate animations, an ORM over five SQL queries.

Correct behaviour and reproducible evidence are graded. Polish is not.
