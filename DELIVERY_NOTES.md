# Delivery notes

## Time spent

Roughly **7 focused hours**, against an 8-hour target.

| Block | Time |
|---|---|
| Reading the brief, architecture, verifying provider facts | 1h 00 |
| Database, catalogue, per-day availability | 0h 35 |
| Draft versioning, confirmation tokens, idempotent booking | 0h 40 |
| Tool layer, validation, the six scenarios as shared code | 1h 10 |
| Voice: ephemeral tokens, WebRTC, tool loop, barge-in, instrumentation | 1h 00 |
| Reviewer page, cost model, metrics | 0h 55 |
| Measurement runs and three rounds of fixing the instrumentation | 0h 40 |
| Documentation | 0h 45 |

Unfinished, and deliberately so: the storefront was left at "clean and legible"
rather than polished, because the brief weights correctness and evidence at 80%
and I would rather spend the last hour on the reviewer page than on the hero.

---

## AI tools and models used

| Tool | Used for |
|---|---|
| **Claude Opus 5** (Claude Code) | All implementation, schema design, tests, documentation |
| **Claude Opus 5**, 8 agents with web access | Verifying model ids, prices, API shapes against live provider docs |
| **Claude Opus 5**, 9 agents with web access | Scouting reusable components, checking licences and repo liveness |
| **Claude Opus 5**, 21 agents | Adversarial review: attacking the booking invariants, then verifying each finding |
| **ChatGPT** (browser) | Researching how real rental catalogues present availability and day rates |

The code is AI-generated throughout. What I contributed is the architecture —
the four-gate confirmation, the token-per-version design, the decision to put
exactly-once in the schema rather than in code — the verification strategy, and
every judgement about which generated output to keep.

---

## How I checked the AI's output

Four times, each catching something real.

**1. A trap test written before the implementation.** Per-day peak availability
is the one place a language model reliably writes plausible, wrong code: it sums
the quantity of every reservation overlapping the requested range. I wrote the
test first. It inserts two Tripod B bookings that do not overlap each other —
1–2 November and 5–6 November — and asks for availability across 1–6 November.
The correct answer is 2 free; a naive sum answers 1 and silently refuses
bookings that should succeed.

**2. Bypassing the application entirely.** For "a repeated confirmation must not
create a duplicate", asserting the code path proves only that the code path
works. The test instead inserts a second reservation with the same `draft_id`
straight into the database, and asserts `UNIQUE constraint failed`. Exactly-once
is now a property of the schema, not of code a future bug could route around.

**3. An adversarial review of the invariants.** With the suite green at 43
tests, I ran a swarm of agents whose only instruction was to break the
invariants, along five separate lines of attack, with each claim independently
re-checked by an agent told to refute it. Nine claims were raised; **four were
real and five were refuted**, including one that misread the code and one that
described real behaviour which broke no invariant.

The four real ones, all fixed and all now covered by regression tests:

| Found | Severity |
|---|---|
| Two concurrent `set_request` calls created two drafts for one conversation; the losing one kept a live token no correction could rotate, and it could be booked | high |
| `confirm_booking` did not check that the draft belonged to the caller, and `/api/state` returned the live confirmation token for any session id | medium |
| `check_availability` bounded neither endpoint, so one request expanded millions of days and blocked the server for seconds | medium |
| A token stayed valid across midnight, so a request made for today could be booked after its start date had passed | low |

**4. Verifying that the fixes' tests actually fail without them.** I removed two
of the guards and confirmed the corresponding tests went red, then restored
them. A regression test that passes either way proves nothing.

---

## Sample inputs and results

Full detail in [`TEST_CASES.md`](./TEST_CASES.md). Expected outcomes were
committed before the runs. Latest run 2026-09-14: **6 of 6 scenarios, 33 of 33
checks passed.**

| ID | Input | Expected | Actual |
|---|---|---|---|
| TC01 | "One Tripod B from October 15 to 17" → "Yes, confirm" | 1 reservation, 2 remaining | as expected |
| TC02 | Dates given, then corrected, then confirmed | 1 reservation on the new dates, 0 on the old | as expected |
| TC03 | "Two Camera A from October 10 to 12" | unavailable, no token, 0 written | as expected |
| TC04 | Interruption with new dates, old confirmation attempted | superseded request refused, 1 reservation on the new dates | as expected |
| TC05 | "Yes, confirm it" twice | same reference, still 1 reservation | as expected |
| TC06 | "I need the camera next week" | clarification by voice, 0 written | as expected |

Plus 49 unit and integration tests via `npm test`.

---

## What failed along the way

Listed because the failures are more informative than the passes.

**Every API route returned 500, with a fully green test suite.** `.env` ships
with `DATABASE_URL=` blank, and `??` treats an empty string as a value, so the
database client was handed `''`. The tests never caught it because they always
set the variable explicitly. Found by curling the running server. This is the
single strongest argument for smoke-testing the real application rather than
trusting the suite.

**I measured latency backwards.** Server VAD only reports a turn as ended after
hearing a full silence window, so the event arrives about 500 ms *after* the
customer actually stopped. I subtracted that window instead of adding it. The
bug broke nothing and made the numbers look half a second better than reality —
it surfaced only because subtracting produced impossible negative values. Had I
guessed 200 ms instead of 500, the figures would have been plausible and wrong.

**The "was this turn interrupted" flag never fired.** It read a state that
handling the barge-in had already cleared, so every turn was marked clean, even
in a session with nine interruptions. Fixed in the browser, and also derived
server-side from the recorded interruption events — which reclassified the
sessions already on disk instead of requiring another run.

**The audible-onset measurement never landed.** The sample closed when the
server said it had started sending audio, which is by definition before anything
is hearable. The check always arrived to a closed sample.

**The adversarial agents left nine scratch files in the repository.** Caught by
listing the working tree afterwards. Anything that writes to disk on your behalf
needs checking after it runs.

**The API key was pasted into `.env.example`** — the file that is committed. Moved
to `.env`, template cleaned, `.gitignore` adjusted so the template is tracked and
the real file is not. No commits had been made, so it never entered history.

---

## Measured speed

14 turns across one conversation, silence window 500 ms.

| Measure | n | min | median | p95 | max |
|---|---|---|---|---|---|
| Turn end → answer begins | 14 | 1139 | **1386 ms** | 2301 | 2301 |
| Turn end → actually audible | 14 | 1242 | **1584 ms** | 2435 | 2435 |
| Of those, not following an interruption | 6 | 1140 | 1467 | 2129 | 2129 |

**How the timestamps were taken.** The turn-end mark is the arrival of
`input_audio_buffer.speech_stopped` on the WebRTC data channel, taken with
`performance.now()`. Because server VAD only fires that event after a full
silence window, the window is added back to approximate the moment the customer
actually stopped talking. The first-audio mark is the arrival of
`output_audio_buffer.started`. The audible mark is independent: an `AnalyserNode`
on the incoming audio track watches for the first frames above a noise floor,
plus the browser's reported `AudioContext.outputLatency`.

**What the figures exclude.** `output_audio_buffer.started` is emitted
server-side, so the first figure is a lower bound — it excludes network transit
and jitter buffering. The audible figure covers those, which is why it sits
about 200 ms higher, and is the more honest answer to "when did a person hear
something".

**Observations.** Turns needing a database lookup are the slow ones: the model
makes one pass to call the tool and another to speak the result. Turns with no
lookup land at 805–988 ms. And interrupting does not make the agent slower to
recover — the uninterrupted median is slightly *higher*, not lower.

For context, the only public measurement of this API with a stated methodology
is 1.76–1.86 s (webrtcHacks, January 2025), whose author notes results have
improved since. We are in a better range, on a sample of 14 turns, on one
machine and one network.

---

## Measured cost

From the token counts the API returns with each response — not an estimate of
how long anyone spoke. 23 responses across 2.49 minutes of conversation.

| Component | Tokens | USD | Share |
|---|---|---|---|
| Speech generation (audio out) | 3,477 | $0.0695 | 64% |
| Audio input | 1,448 | $0.0145 | 13% |
| Input transcription | — | $0.0112 | 10% |
| Reasoning + text out | 2,382 | $0.0057 | 5% |
| Text in (uncached) | 5,984 | $0.0036 | 3% |
| Text in (cached) | 45,248 | $0.0039 | 4% |
| **Total** | | **$0.1085** | |
| **Per minute** | | **$0.0435** | |

**Retries: none occurred.** A failed tool call returns a spoken apology rather
than retrying, so retry cost in the measured run is zero. A retry would cost one
further model response, roughly $0.005 at the observed rate.

**Paid intermediaries: none.** The browser connects directly to OpenAI over
WebRTC; there is no telephony provider, no media server, no agent platform in
the path. The only server work is minting a session token and executing tool
calls.

### Pricing assumptions

All verified against the live pricing page on 2026-09-14 and recorded in
`src/config/pricing.ts` with the source URL beside each figure.

| Item | Rate |
|---|---|
| `gpt-realtime-2.1-mini` audio in | $10.00 / 1M tokens |
| `gpt-realtime-2.1-mini` audio out | $20.00 / 1M tokens |
| `gpt-realtime-2.1-mini` cached audio in | $0.30 / 1M tokens |
| `gpt-realtime-2.1-mini` text in / cached / out | $0.60 / $0.06 / $2.40 / 1M tokens |
| `gpt-transcribe` input transcription | $0.0045 / minute |

**Sanity check.** OpenAI bills a comparable full-duplex voice model at a flat
$0.05 per minute. Our computed $0.0435 lands in the same place, which is the
check that the arithmetic is not out by an order of magnitude.

**Caching matters more than it looks.** 45,248 of 51,232 input tokens were
cached. Without that, input would cost roughly four times more. The cache warms
over a conversation, so a short call costs more per minute than a long one — the
figure above should not be extrapolated to 10-second interactions.

### Hosting, reported separately

| | Service | USD / month |
|---|---|---|
| As deployed | Vercel Hobby | $0 |
| | Turso Free | $0 |
| | **Total** | **$0** |
| If run commercially | Vercel Pro | $20 |
| | Turso Developer | $5.99 |
| | **Total** | **$25.99** |

Free credit is not zero operating cost. Vercel's Hobby plan explicitly forbids
commercial use, so a real rental desk running this pays $25.99/month before a
single conversation. The API cost above is entirely separate and scales with
usage.

---

## The quality / speed / cost tradeoff I chose

**Architecture.** I compared a speech-to-speech model over WebRTC against a
cascaded STT → LLM → TTS pipeline, and against the browser's own Web Speech API.
The pipeline is cheaper per minute but requires building voice-activity
detection, endpointing, and streaming-TTS cancellation by hand — roughly three
hours of fiddly work, and barge-in is explicitly graded here. The Web Speech API
is free but is still prefixed, is documented as "not Baseline", and ships audio
to a server anyway. I chose the realtime model: it makes natural turn-taking and
interruption configuration rather than engineering.

**Model tier.** I chose `gpt-realtime-2.1-mini` over the full tier, which is
3.2× more expensive per audio token. This is the tradeoff I am most confident
about, and the reason is structural: every decision that has to be correct was
moved out of the model and into the backend. The model resolves three item names
and two dates and reads back what a tool returned. That does not need the
stronger tier, and the guarantees do not weaken if the model is worse — an
unavailable request has no token to book with, whichever model asked.

**Turn detection.** I chose fixed-window server VAD over semantic turn
detection, accepting slightly less natural pauses in exchange for a *known*
500 ms detection delay. Semantic detection adapts to the speaker but its delay
is model-determined with only an upper bound, which would make an honest latency
figure impossible to state. I preferred a measurable system to a marginally
smoother one.

**Where I spent quality.** On the parts a reviewer can check: four independent
gates on confirmation, exactly-once enforced by the schema, per-day availability
with a trap test, an adversarial review of the invariants, and a page that
re-runs all of it on demand. Not on the storefront's appearance.

---

## Reused components, and what is mine

| Reused | Source | Licence |
|---|---|---|
| Project scaffold | `create-next-app` | MIT |
| WebRTC connection sequence (~30 lines: peer connection, `oai-events` data channel, SDP exchange) | OpenAI's official WebRTC guide | docs sample |
| `@libsql/client`, `zod`, `vitest`, `tsx`, Tailwind | npm | MIT / Apache-2.0 |

Everything else is written for this brief: the availability engine, the draft
state machine, the four-gate confirmation, the tool layer and its validation,
the scenario runner shared between tests and the reviewer page, the latency
instrumentation, the cost model, and the `doctor` script that enforces the
project's own structural rule.

I deliberately did **not** reuse several things a search would suggest: the
highest-starred realtime sample repository ships a superseded endpoint and would
simply fail to connect; two popular WebRTC wrappers carry no licence at all; and
`date-fns`'s interval helper treats a booking ending Tuesday and one starting
Tuesday as non-overlapping, which under inclusive-day semantics would silently
permit a double booking.

---

## What I would improve next

In the order I would actually do it.

1. **Speak while the database is checked.** Turns needing a lookup are about a
   second slower, because the model makes two passes. A short filler — "let me
   check" — emitted as soon as a tool call starts would remove the silence
   without touching the transaction. This is the largest perceived-speed win
   available and it costs almost nothing.

2. **Make `sessionId` real.** It currently comes from the browser unverified. The
   booking invariants hold regardless, but a signed session cookie would make
   session identity a boundary rather than a convention, and would let more than
   one conversation run safely.

3. **Reduce spoken output.** Audio generation is 64% of the cost. Tightening the
   agent's instructions toward shorter confirmations is the highest-leverage
   cost change, and it also shortens time-to-understanding for the customer.

4. **Measure properly.** Fourteen turns on one machine supports a median and
   nothing stronger. A scripted harness replaying recorded audio would give
   percentiles worth quoting, and would catch latency regressions.

5. **Handle the speaker-echo problem in software.** Requiring headphones is a
   workaround. Suppressing input while the agent speaks, or raising the VAD
   threshold during output, would make the demo robust on a laptop.

6. **Let the customer see and edit the draft.** The request card is read-only.
   Allowing a click to correct a date would respect the people for whom voice is
   the harder channel — without reintroducing the booking form the brief rules
   out.
