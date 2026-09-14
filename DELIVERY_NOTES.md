# Delivery notes

## Time spent

**2 hours 26 minutes of elapsed wall-clock time**, of which roughly 20 minutes
was an enforced pause on my AI tooling. So about **2 hours 5 minutes of actual
work**, against an eight-hour ceiling.

Measured, not estimated, on 2026-09-14. The start is the creation time of the
first working file, 19:08; the end is the last commit, 21:40. Note that git
history only begins at 20:54 — the repository was initialised late — so commit
timestamps corroborate the second half of the table and file modification times
the first.

| Phase | Clock |
|---|---|
| Reading the brief, architecture, verifying provider facts against live docs | 19:08 – 19:36 |
| Scaffold, database, catalogue, per-day availability | 19:36 – 19:38 |
| Draft versioning, confirmation tokens, idempotent booking | 19:38 – 19:42 |
| Tool layer, validation, the six scenarios as shared code | 19:42 – 19:46 |
| Adversarial review of the invariants, and fixing what it found | 19:46 – 20:00 |
| *(paused — AI usage limit)* | 20:00 – 20:20 |
| Voice: ephemeral tokens, WebRTC, tool loop, barge-in, instrumentation | 20:22 – 20:30 |
| Measurement runs, three rounds of fixing the instrumentation, reviewer page | 20:30 – 20:45 |
| Documentation, repository, deployment | 20:45 – 21:05 |
| Storefront that answers for the dates spoken aloud; acknowledgement before a lookup | 21:05 – 21:15 |
| Extracting turn timing so it could be tested without a microphone | 21:15 – 21:40 |

This is far under the ceiling because the work was AI-assisted throughout: I
directed the architecture and the verification strategy, and the code was
generated. The eight hours is a limit, not a quota, and I would rather report
ninety honest minutes than pad them.

**A correction worth recording.** An earlier draft of this file claimed seven
hours. That figure was not measured — I had estimated how long each block
*would* take a person and written the estimate down as fact. It was wrong by a
factor of five, and the repository's own timestamps would have exposed it. It is
noted here because a delivery note that gets its own headline number from
intuition has no standing to report latency and cost.

Unfinished, and deliberately so: the storefront was left at "clean and legible"
rather than polished, because the brief weights correctness and evidence at 80%.

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

Five times, each catching something real. The last one was a review of the
finished submission, and it found errors in this very document.

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

**5. Making the untestable part testable, after it bit me three times.** Three
latency-measurement bugs shipped in a row, each caught only by reading recorded
data after a manual conversation. None was about audio; all three were wrong
assumptions about the order of events. They survived because the logic sat
inside the WebRTC client alongside `RTCPeerConnection` and `AudioContext`, so
nothing could exercise it without a browser and a voice.

I extracted it into `src/voice/turn-timer.ts`, free of browser APIs, and wrote
eleven tests that replay the event sequences a real conversation produces. Then
I restored each of the three bugs in turn to confirm the suite catches them:

| Bug restored | Tests failing |
|---|---|
| Subtract the silence window instead of adding it | 6 of 11 |
| Close the turn on any response without a tool call | 1 of 11 |
| Accept an audible reading from before the audio was sent | 1 of 11 |

All three would have been caught in under a second instead of across four
manual conversations. The client delegates to this module, so the tested logic
is the logic that runs.

**6. An adversarial review of the finished submission.** Forty agents went
through the repository and the deployed site against the brief, on five separate
lines — requirement coverage, honesty of every stated number, what a reviewer
sees on `/review`, what a customer sees on the storefront, and what a stranger
makes of the repository — with each claim re-checked by an agent told to refute
it. Twenty-six findings survived that check.

The ones that mattered were in this document: the cost table was wrong in three
connected ways, two interruption counts contradicted the recorded events, and
the time-spent section attributed more to git history than git history can
support. Those are recorded under "what failed" below rather than silently
fixed. The rest were clarity problems on `/review` — raw field names used as
headings, the headline figures buried below prose, a table row whose label
implied it was a subset of the row above.

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

Plus 60 unit and integration tests via `npm test`.

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

**`npm run reset-db` ignored `.env`.** Invisible locally, where the default is
correct, but the documented setup step would silently have seeded the local file
instead of the production database.

**The reviewer's "Run all checks" button wrote to disk.** It worked locally and
would have failed in production, where the filesystem is read-only — on the one
button a reviewer is most likely to press. Caught by testing the deployment
rather than the dev server. It now runs against an in-memory database.

**Asking for a reply collided with one already running.** Adding the
acknowledgement lengthened the window in which the customer can start speaking,
and turn detection then creates a response of its own; our request for the tool
result to be spoken landed on top of it and the API refused outright. Replies
are now queued, and a queued reply is dropped on a barge-in because it answers
a request the customer has just changed. My own optimisation opened this one.

**Three latency-measurement bugs, described above.** Worth separating from the
rest: building the voice agent was easier than measuring it honestly. Three
iterations went not into features but into making the number mean what the
label next to it says.

**This document reported the cost wrongly, in three connected ways.** A review
of the finished submission recomputed every figure against the live
`/api/review` and found that the cost table omitted the cached-text row
entirely, and that the row labelled "text in (cached)" actually carried the
cached *audio* count. The visible rows therefore missed their own total, and a
paragraph derived from the same mix-up concluded that caching had done little —
when in fact 86% of text input was served from cache and it took roughly a fifth
off the bill. A separate claim, that per-minute cost falls as a conversation
lengthens, was a pattern read from two sessions that five sessions contradict.
All of it is corrected above, and the corrections are noted in place rather than
quietly swapped.

The uncomfortable part is that these were the numbers arguing for the project's
own rigour. Getting the measurement right took as much attention as getting the
booking right, and it needed an adversarial pass to finish the job.

---

## Measured speed

54 turns across five conversations, silence window 500 ms.

| Measure | n | min | median | p95 | max |
|---|---|---|---|---|---|
| Turn end → any audio begins | 54 | 805 | **1186 ms** | 2476 | 3441 |
| Turn end → actually audible | 53 | 988 | **1351 ms** | 2839 | 3603 |
| Turn end → the answer itself | 30 | 805 | **1414 ms** | 4865 | 5124 |
| Any audio, not following an interruption | 37 | 805 | 1170 | 3313 | 3441 |

### Where the time actually goes

This is the finding worth the measurement.

| Turn type | n | min | median | max |
|---|---|---|---|---|
| No database lookup — the answer | 21 | 805 | **1108 ms** | 1908 |
| Lookup — the acknowledgement | 33 | 875 | **1219 ms** | 3441 |
| Lookup — the answer | 9 | 3180 | **4001 ms** | 5124 |

A turn that has to consult the database takes **3.6× longer** to reach its
actual answer, because the model makes two passes: one to call the tool, one to
speak the result. Nothing about the database is slow — the query is a few
milliseconds. The cost is the second pass through the model.

The agent now says a short acknowledgement before looking up. That lands at
1219 ms — indistinguishable from a normal answer — so the silence disappears.
It does not make the answer arrive sooner, and both rows are reported precisely
so that improvement cannot be read as a speed-up. Measuring only
time-to-first-audio after adding an acknowledgement would have been gaming the
metric.

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

**Observations.** Interrupting does not make the agent slower to recover: the
uninterrupted median (1170 ms) is barely different from the overall one
(1186 ms). And one audible reading was dropped as impossible — it claimed a
turn was heard before its audio had been sent, because the onset detector had
caught the previous answer still playing out after a barge-in. The reviewer page
states the count rather than quietly excluding it.

For context, the only public measurement of this API with a stated methodology
is 1.76–1.86 s (webrtcHacks, January 2025), whose author notes results have
improved since. Our figure for a turn needing no lookup sits below that; a turn
needing one sits above. On 54 turns, one machine, one network.

---

## Measured cost

From the token counts the API returns with each response — not an estimate of
how long anyone spoke. 96 responses across 11.5 minutes of conversation.

| Component | Tokens | USD | Share |
|---|---|---|---|
| Speech generation (audio out) | 10,918 | $0.2184 | 58% |
| Input transcription | — | $0.0515 | 14% |
| Audio input | 4,929 | $0.0493 | 13% |
| Reasoning + text out | 9,764 | $0.0234 | 6% |
| Text in (uncached) | 28,033 | $0.0168 | 4% |
| Text in (cached) | 170,496 | $0.0102 | 3% |
| Audio input (cached) | 18,944 | $0.0057 | 2% |
| **Total** | | **$0.3754** | |
| **Per minute** | | **$0.0328** | |

Every row is charged and the seven sum to the total. Cached tokens are a subset
of the input counts, billed at the cached rate and subtracted from the uncached
row rather than added on top.

**Per-session cost ranged $0.0283 to $0.0369 per minute** across the five
conversations. There is no visible relationship with session length: the
shortest (0.7 min) came out at $0.0296 and the longest (3.8 min) at $0.0369.
An earlier draft of this document claimed the per-minute cost falls as a
conversation lengthens. It does not — that was a pattern read off two data
points before there were five, and the recomputation is in the table above.

**Retries: none occurred.** A failed tool call returns a spoken apology rather
than retrying, so retry cost in the measured run is zero. A retry would cost one
further model response, roughly $0.004 at the observed rate.

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

**Where the money actually goes.** Speech generation is 58% of the bill, and
audio in and out together are 71%. Text — the instructions, the conversation
history, the tool schemas, the reasoning — is 12% in total, cached or not.
Shortening what the agent says is therefore worth far more than any prompt
optimisation, and it shortens the customer's wait at the same time.

**Caching does a lot of quiet work.** 170,496 of 198,529 text input tokens —
86% — were served from cache. At the uncached rate those would have cost
$0.1023 instead of $0.0102, so caching removed about $0.09 from a $0.38 bill:
roughly a fifth of the total. The instructions and the tool schemas are resent
on every turn, and without caching that would be the second-largest line item
rather than a rounding error.

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

1. **Remove the second model pass on a lookup turn.** The acknowledgement hides
   the silence, but the answer still takes 4.0 s against 1.1 s. The fix is not a
   better filler — it is not going back to the model twice. Pre-fetching
   availability for the item as soon as it is named, so the tool result is
   already in hand when the dates arrive, would collapse most of that gap. This
   is the single largest real improvement available.

2. **Make `sessionId` real.** It currently comes from the browser unverified. The
   booking invariants hold regardless, but a signed session cookie would make
   session identity a boundary rather than a convention, and would let more than
   one conversation run safely.

3. **Reduce spoken output.** Audio generation is 58% of the cost. Tightening the
   agent's instructions toward shorter confirmations is the highest-leverage
   cost change, and it also shortens time-to-understanding for the customer.

4. **Measure across more than one machine.** Fifty-four turns support a median;
   they do not support a p95, and they say nothing about other networks or
   devices. The turn-timing logic is now covered by replayable tests, so what is
   missing is real audio: a harness that replays recorded speech through the
   whole stack would turn these medians into figures worth quoting.

5. **Handle the speaker-echo problem in software.** Requiring headphones is a
   workaround. Suppressing input while the agent speaks, or raising the VAD
   threshold during output, would make the demo robust on a laptop.

6. **Let the customer see and edit the draft.** The request card is read-only.
   Allowing a click to correct a date would respect the people for whom voice is
   the harder channel — without reintroducing the booking form the brief rules
   out.
