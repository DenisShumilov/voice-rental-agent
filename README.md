# Equipment rental desk — voice booking agent

A browser voice agent for a small equipment rental desk. The customer speaks;
the agent listens, checks real availability against a database, asks for
confirmation, and saves exactly one reservation. There is no booking form — the
whole transaction happens in conversation, and the screen shows what the backend
understood as it happens.

The governing rule is one line: **the model speaks, the database decides.** The
language model interprets speech, asks clarifying questions and calls tools. It
never decides whether stock exists, whether a booking is allowed, whether a
confirmation is still current, or whether a reservation already exists.

```
What it is:    equipment rental where bookings are made by talking
Run it:        npm install && npm run reset-db && npm run dev
Open:          /         the storefront
               /review   the evidence page for a reviewer
```

---

## Live demo

| Surface | URL |
|---|---|
| Storefront | https://voice-rental-agent.vercel.app |
| Reviewer view | https://voice-rental-agent.vercel.app/review |
| Walkthrough video | _added with the submission_ |
| Repository | `DenisShumilov/voice-rental-agent` — private; access granted to the reviewer on submission |

Press **Run all checks** on the reviewer view to re-run the six required
scenarios against a scratch in-memory database. It reports expected vs actual
per check and the database before and after each one, and it cannot disturb the
bookings made on the storefront.

A microphone is required. **Use headphones** — on open speakers the agent hears
itself and treats it as the customer interrupting.

---

## Architecture

```
  Browser                                   OpenAI Realtime
  ┌──────────────────────┐   WebRTC audio   ┌──────────────────┐
  │ mic ────────────────────────────────────▶                  │
  │ speaker ◀───────────────────────────────  gpt-realtime-2.1-mini
  │                      │  "oai-events"    │                  │
  │ storefront / panel   │◀────────────────▶│  function calls  │
  └───────────┬──────────┘   data channel   └──────────────────┘
              │
              │ POST /api/tools          the browser relays; it does not decide
              ▼
  ┌──────────────────────┐
  │  Next.js server      │
  │  availability        │
  │  draft state machine │──────▶ SQLite (libSQL)
  │  idempotent booking  │        the only source of truth
  └──────────────────────┘
```

The browser is a transport. A tool call from the model is forwarded to the
server, executed there, and the result is handed back for the agent to read
aloud. A hostile browser cannot oversell or double-book: the invariants are
enforced server-side and, for the ones that matter most, by the schema itself.

The real API key never reaches the browser. `/api/realtime/session` mints a
short-lived client secret with the model, instructions and tool list already
baked in, so the browser cannot widen what the agent may do.

---

## Quick start (local)

Requires Node 22 or newer (the scripts use `--env-file-if-exists`). Built and tested on Node 24.

```bash
npm install
cp .env.example .env        # then add OPENAI_API_KEY
npm run reset-db            # creates and seeds the database
npm run dev
```

Open `http://localhost:3000`, allow the microphone, press **Start talking**.

| Command | What it does |
|---|---|
| `npm run dev` | development server |
| `npm run reset-db` | rebuilds the database and reloads catalogue and seed. Recorded events — the latency and cost evidence — are carried across; `--wipe-events` drops those too |
| `npm run sync-catalog` | adds or updates `items` rows from the catalogue without dropping anything. This is the command to run after editing `src/config/catalog.ts` |
| `npm test` | 60 unit and integration tests |
| `npm run doctor` | checks that changeable values live in exactly one file |
| `npm run check` | typecheck + tests + doctor — the gate before anything is "done" |
| `npm run report` | regenerates the measured figures in this file and the delivery notes from the recorded conversations |

The database is a local SQLite file at `data/rental.db`. Deleting it is
harmless; `npm run reset-db` recreates it, directory and all.

---

## Inventory

| Item | Stock |
|---|---|
| Camera A | 2 |
| Tripod B | 3 |
| Microphone C | 1 |

The brief fixes these three names and these three stock levels; nothing else
about the equipment is stated anywhere, because nothing else is known.

One reservation is seeded: **Camera A ×1, 10–12 October 2026 inclusive**. So on
those three days only one of the two Camera A units is free. A local
`npm run reset-db` returns to exactly that state.

The live demo has moved on from it: the recorded conversations left real
bookings behind, including a second Camera A on 10–12 October, so that date now
shows nothing free. Those rows are the evidence behind the latency and cost
figures below and are deliberately not cleared. To see the seeded state,
press **Run all checks** on `/review` — every scenario reports the database
before and after, starting from a clean seed each time.

---

## Voice tool reference

The model has three tools and no other way to affect anything.

| Tool | Arguments | Purpose |
|---|---|---|
| `set_request` | `item?`, `quantity?`, `start_date?`, `end_date?` | Create or update the current request. Omitted fields keep their previous value — this is how a correction works. Re-checks availability and rotates the confirmation token. |
| `confirm_booking` | `draft_id`, `version`, `confirmation_token` | Save the booking, if all four gates pass. |
| `check_availability` | `item`, `start_date`, `end_date` | Read-only lookup. Never writes, never changes the current request. |

Every result carries `facts` (what is true) and `guidance` (what to do next).
The agent is instructed to state only what the facts contain.

---

## Worked examples

A request that can be met:

```jsonc
// → POST /api/tools  { "tool": "set_request",
//                      "args": { "item": "Tripod B", "start_date": "2026-10-15",
//                                "end_date": "2026-10-17" } }
{
  "tool": "set_request",
  "status": "available",
  "facts": {
    "draft_id": "59fd08c1-…", "version": 1,
    "item": "Tripod B", "quantity": 1,
    "start_date": "2026-10-15", "end_date": "2026-10-17",
    "total_stock": 3, "available": 3,
    "confirmation_token": "8f2c…"
  },
  "guidance": "Read the request back to the customer and ask them to confirm. Do not book anything yet."
}
```

A request that cannot — note that **no token is issued**, so the model has
nothing to confirm with:

```jsonc
{
  "tool": "set_request",
  "status": "unavailable",
  "facts": { "item": "Camera A", "quantity": 2, "available": 1, "total_stock": 2 },
  "guidance": "Only 1 of 2 are free for those dates, so this cannot be booked. …"
}
```

Confirming the same booking twice — the second call writes nothing and returns
the first reservation:

```jsonc
{
  "tool": "confirm_booking",
  "status": "already_confirmed",
  "facts": { "booking_reference": "250b41fd-…", "remaining_for_those_dates": 2 },
  "guidance": "This booking already exists and nothing new was saved. …"
}
```

---

## Correctness invariants

**Availability is the minimum free units across every day of the inclusive
range.** For each day, sum the quantity of confirmed reservations covering that
day; take the maximum of those daily sums; subtract from total stock. It is
*not* the sum of reservations overlapping the range — that double-counts
reservations which never overlap each other, and silently refuses bookings that
should succeed.

**A reservation is written only when four gates pass.**

1. The draft is not already confirmed.
2. The request is complete and currently available.
3. The supplied token and version match the draft's current ones.
4. Inside a write transaction, availability still holds and `UNIQUE(draft_id)`
   accepts the insert.

**A confirmation token is issued only alongside `available`.** An incomplete,
ambiguous or unavailable request has no key, so the model cannot book it even if
it tries. Every `set_request` bumps `version` and mints a new token, which is
what makes a superseded request unbookable.

**One live draft per conversation**, enforced by a partial unique index. Without
it, two overlapping `set_request` calls each insert a draft and the losing row
keeps a token no later correction can rotate.

**The model is an untrusted caller.** Every tool argument is parsed by a schema,
unknown tools are refused, date spans are bounded before they are expanded, and
a draft id is not a capability — confirming requires owning the conversation.

---

## Test evidence

```bash
npm test          # 60 tests
npm run check     # typecheck + tests + doctor
```

Or press **Run all checks** on `/review`, which executes the same six scenarios
against a scratch database and shows expected vs actual per check, plus the
database before and after each one.

| Suite | Covers |
|---|---|
| `tests/availability.test.ts` | per-day peak, inclusive bounds, adjacency, the sum-vs-peak trap |
| `tests/drafts.test.ts` | versioning, token rotation, partial updates, concurrent requests |
| `tests/booking.test.ts` | the four gates, idempotency, cross-session refusal, clock drift |
| `tests/tools.test.ts` | argument validation, unknown tools, unbounded spans, read-only lookups |
| `tests/scenarios.test.ts` | the six required scenarios, end to end through the tool layer |
| `tests/turn-timer.test.ts` | replayed event sequences: barge-in, lookup turns, impossible readings |
| `tests/transcript.test.ts` | replayed arrival orders: a transcription landing after the reply it prompted |
| `tests/db.test.ts` | blank environment variables |

Expected results are declared in `src/lib/scenarios.ts` and in
[`TEST_CASES.md`](./TEST_CASES.md), which also records the last actual run.

**Not covered by automated tests:** the audio path itself — microphone capture,
speech recognition, and whether the agent actually stops talking when
interrupted. Those are verified by hand and recorded as events; `/review` shows
the interruption count per conversation.

---

## Latency and cost

Measured, not promised. Both come from recorded conversations; `/review` shows
the live figures.

**Latency.** Regenerated from the recorded conversations by `npm run report`,
never transcribed by hand.

<!-- figures:latency -->
Measured on 2026-09-15 across 10 recorded conversations,
silence window 500 ms. All figures in milliseconds.

| Measure | n | min | median | p95 | max |
|---|---|---|---|---|---|
| Turn end → any audio begins | 71 | 805 | **1147** | 2181 | 3441 |
| Turn end → actually audible | 70 | 988 | **1340** | 2813 | 3603 |
| Turn end → the answer itself | 47 | 805 | **1204** | 4413 | 5124 |
| Any audio, excluding turns after an interruption | 44 | 805 | **1102** | 2476 | 3441 |

Split by whether the turn had to consult the database, which is where the
time actually goes:

| Turn type | n | min | median | p95 | max |
|---|---|---|---|---|---|
| No database lookup — the answer | 35 | 805 | **1108** | 1773 | 1908 |
| Lookup — the acknowledgement | 36 | 875 | **1204** | 3313 | 3441 |
| Lookup — the answer | 12 | 2969 | **4007** | 5124 | 5124 |

A turn that consults the database takes **3.6× longer** to reach its
answer, because the model makes two passes: one to call the tool, one to speak
the result. The agent acknowledges before looking up, which removes the silence
without making the answer arrive sooner — both rows are here so that cannot be
read as a speed-up.

71 turns recorded, 44 of them not following an interruption. 1 audible reading dropped as impossible — the onset detector caught the previous answer still playing out after a barge-in. The answer time is not measurable on 23 turns recorded before the client counted lookups correctly. A sample this size supports a median, not a promise.
<!-- /figures:latency -->

Server VAD reports the turn as ended only after hearing a full silence window,
so that window is *added back* to reach "end of the customer's turn", not
subtracted from it. The audible figure adds the browser's reported output-device
latency.

**Cost.**

<!-- figures:cost -->
Measured on 2026-09-15 from the token counts the API returned with each
response — 124 responses across 13.8 minutes of conversation.

| Component | Tokens | USD | Share |
|---|---|---|---|
| Speech generation (audio out) | 14,992 | $0.2998 | 60% |
| Input transcription | — | $0.0622 | 12% |
| Audio input | 6,787 | $0.0679 | 14% |
| Reasoning + text out | 12,228 | $0.0293 | 6% |
| Text in (uncached) | 40,079 | $0.0240 | 5% |
| Text in (cached) | 189,120 | $0.0113 | 2% |
| Audio input (cached) | 19,584 | $0.0059 | 1% |
| **Total** | | **$0.5006** | |
| **Per minute** | | **$0.0362** | |

All seven rows are charged, and the total is their exact sum — printed
rounded to four decimals, so adding up the column can miss it by a hundredth
of a cent. Cached tokens are a subset of the input counts, billed at the
cached rate rather than added on top.

Audio in and out together are 75% of the bill, so shortening what the agent
says is worth more than any prompt optimisation. 83% of text input was
served from cache; at the uncached rate those tokens would have cost
$0.1135 instead of $0.0113.
<!-- /figures:cost -->

Prices are in `src/config/pricing.ts`, each with the page it was read from.
Hosting is reported separately in [`DELIVERY_NOTES.md`](./DELIVERY_NOTES.md).

---

## Out of scope this pass

Deliberately not built, because the brief excludes them or they buy no
correctness: accounts and authentication, payments, phone numbers, real rental
integrations, a second language, a fourth item, a cart or checkout, a dark
theme, an admin panel.

Known limitations:

- **One conversation at a time.** `sessionId` comes from the browser and is not
  authenticated. The booking invariants hold regardless — a hostile client can
  book, but cannot oversell, double-book, or touch another conversation's
  draft — but session identity itself is not a security boundary here.
- **Speakers cause false interruptions.** The agent's own voice reaches the
  microphone and server VAD treats it as the customer. Headphones fix it.
- **Turns that need a database lookup are slower**, because the model makes one
  pass to call the tool and another to speak the result.
- **Relative dates are left to the model.** It is told today's date and
  instructed to ask rather than guess; the backend refuses anything it cannot
  resolve, but it cannot tell a confident wrong guess from a right one.
- The latency and cost figures come from a small number of conversations on one
  machine and one network.

---

## Environment variables

| Name | Required | Notes |
|---|---|---|
| `OPENAI_API_KEY` | yes | Server-side only. Never sent to the browser. |
| `DATABASE_URL` | no | Defaults to `file:./data/rental.db`. Set to a Turso URL in production. |
| `DATABASE_AUTH_TOKEN` | no | Only with a remote database. |

## Security notes

- The API key stays on the server. The browser receives a short-lived client
  secret, minted per session, with the model and tool list fixed server-side.
- Confirmation tokens never leave the server in any API response other than the
  tool result that issued them.
- `/api/tools` is unauthenticated, which matches a brief with no accounts. The
  invariants above are what protect the data, not the absence of access.
- `.env` is git-ignored; `.env.example` is committed and must never hold a real
  key.
