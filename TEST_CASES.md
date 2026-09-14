# Test cases

The six checks the brief asks for, plus the invariant tests underneath them.

Expected outcomes were written before the implementation ran: they live in code
in `src/lib/scenarios.ts`, committed alongside the steps that produce them, and
the same definitions drive both `npm test` and the **Run all checks** button on
`/review`. The page a reviewer clicks and the suite CI runs cannot disagree
about what passed.

**Last run:** 2026-09-14T17:51:51Z — 6 of 6 scenarios, 33 of 33 checks passed.

---

## Preconditions

Every scenario starts from a freshly seeded database:

| Item | Stock |
|---|---|
| Camera A | 2 |
| Tripod B | 3 |
| Microphone C | 1 |

One seeded reservation: **Camera A ×1, 2026-10-10 to 2026-10-12 inclusive.**
So on those days one of the two Camera A units is free and one is not.

"Today" is pinned to **2026-09-14** during scenario runs, so that rules about
dates in the past give the same answer whenever the suite is run.

---

## Index

| ID | Given | Input | Expected | Priority | Automated |
|---|---|---|---|---|---|
| TC01 | Tripod B free | "One Tripod B, Oct 15–17" then "Yes, confirm" | 1 reservation, remaining 2 | critical | yes |
| TC02 | Microphone C free | Dates given, then changed, then confirmed | 1 reservation on the new dates, 0 on the old | critical | yes |
| TC03 | 1 of 2 Camera A free Oct 10–12 | "Two Camera A, Oct 10–12" | unavailable, no token, 0 reservations | critical | yes |
| TC04 | Agent mid-answer | Customer interrupts with new dates, then confirms | superseded request refused, 1 reservation on the new dates | critical | yes |
| TC05 | Booking just confirmed | "Yes, confirm it" again | same reference returned, still 1 reservation | critical | yes |
| TC06 | Item named, dates vague | "I need the camera next week" | clarification asked, 0 reservations | critical | yes |
| TC07 | Agent speaking aloud | Customer talks over it | audio stops within one turn, no stale write | critical | manual |

TC01–TC06 run through the real tool layer — the same code path the voice agent
uses. Nothing is stubbed. TC07 is the audio half of TC04 and is verified by ear,
because whether a speaker actually falls silent cannot be asserted in a test.

---

## TC01 — Normal booking
*Requirements: R5, R7, R8*

**Given** Tripod B has 3 units and no existing bookings.

**Steps**

1. "I need one Tripod B from October 15 to 17." → `set_request`
2. "Yes, confirm." → `confirm_booking`

**Expected:** the request is available and a token is issued; the booking is
confirmed; exactly one reservation exists for 2026-10-15 to 2026-10-17; two
units remain free on those dates.

| Check | Expected | Actual | |
|---|---|---|---|
| request is available | `"available"` | `"available"` | PASS |
| a confirmation token was issued | `true` | `true` | PASS |
| booking is confirmed | `"confirmed"` | `"confirmed"` | PASS |
| exactly one reservation saved | `1` | `1` | PASS |
| booked dates | `"2026-10-15 to 2026-10-17"` | same | PASS |
| remaining for those dates | `2` | `2` | PASS |

Database: 1 row → 2 rows.

---

## TC02 — Corrected dates
*Requirements: R3, R20*

**Given** Microphone C has 1 unit. The customer gives dates, then changes them
before confirming.

**Steps**

1. "Book Microphone C from October 20 to 22." → `set_request`
2. "Actually, make that October 21 to 23." → `set_request` *(dates only; the
   item is not repeated, and must survive)*
3. "Yes, confirm." → `confirm_booking`

**Expected:** the correction raises the draft to version 2 and replaces the
token; exactly one reservation is saved, on 21–23; no row anywhere holds the
superseded dates.

| Check | Expected | Actual | |
|---|---|---|---|
| correction bumped the version | `2` | `2` | PASS |
| the old confirmation token was replaced | `true` | `true` | PASS |
| booking is confirmed | `"confirmed"` | `"confirmed"` | PASS |
| exactly one reservation saved | `1` | `1` | PASS |
| saved dates are the corrected ones | `"2026-10-21 to 2026-10-23"` | same | PASS |
| no reservation holds the superseded dates | `0` | `0` | PASS |

Database: 1 row → 2 rows.

---

## TC03 — Insufficient stock
*Requirements: R6, R22*

**Given** Camera A has 2 units and 1 is already booked 2026-10-10 to 2026-10-12
inclusive.

**Steps**

1. "I need two Camera A from October 10 to 12." → `set_request`
2. "Yes, confirm." → `confirm_booking` *(attempted anyway, with a made-up token,
   because no real one was issued)*

**Expected:** the request is unavailable with 1 free; no token exists;
confirming is refused; nothing is written.

| Check | Expected | Actual | |
|---|---|---|---|
| request is unavailable | `"unavailable"` | `"unavailable"` | PASS |
| only one unit is free | `1` | `1` | PASS |
| no confirmation token was issued | `undefined` | `undefined` | PASS |
| confirmation is refused | `"not_available"` | `"not_available"` | PASS |
| no reservation was saved | `0` | `0` | PASS |

Database: 1 row → 1 row.

---

## TC04 — Interruption mid-answer
*Requirements: R19, R20*

**Given** the assistant is part-way through answering when the customer
interrupts with different dates.

**Steps**

1. "I need Camera A from October 10 to 12." → `set_request` *(v1, token issued)*
2. "Actually, make that Camera A from October 13 to 14." → `set_request` *(v2,
   token rotated)*
3. The half-finished turn tries to confirm what it was already saying, using the
   v1 token → `confirm_booking`
4. "Yes, confirm." with the current token → `confirm_booking`

**Expected:** the interrupted turn cannot confirm; the corrected request can;
exactly one reservation exists, on 13–14; the abandoned dates were never saved.

| Check | Expected | Actual | |
|---|---|---|---|
| the interrupted turn cannot confirm | `"stale_confirmation"` | `"stale_confirmation"` | PASS |
| the corrected request confirms | `"confirmed"` | `"confirmed"` | PASS |
| exactly one reservation saved | `1` | `1` | PASS |
| saved dates are the ones said last | `"2026-10-13 to 2026-10-14"` | same | PASS |
| the abandoned dates were never saved | `0` | `0` | PASS |

Database: 1 row → 2 rows.

---

## TC05 — Repeated confirmation
*Requirements: R7, R23*

**Given** the customer confirms, then says "yes, confirm it" again.

**Steps**

1. "One Tripod B from October 15 to 17, please." → `set_request`
2. "Yes, confirm." → `confirm_booking`
3. "Yes, confirm it." → `confirm_booking` *(identical arguments)*

**Expected:** the second call writes nothing and returns the first reservation.

| Check | Expected | Actual | |
|---|---|---|---|
| first confirmation books | `"confirmed"` | `"confirmed"` | PASS |
| second confirmation is a replay | `"already_confirmed"` | `"already_confirmed"` | PASS |
| both return the same booking reference | same id | same id | PASS |
| still exactly one reservation | `1` | `1` | PASS |

Database: 1 row → 2 rows.

There is a second line of defence under this one:
`tests/booking.test.ts` bypasses the application entirely and inserts a
duplicate reservation straight into the database. The schema rejects it with
`UNIQUE constraint failed`. Exactly-once is a property of the schema, not of
code that could be bypassed.

---

## TC06 — Ambiguous dates
*Requirements: R21*

**Given** the customer names an item but not dates the system can resolve.

**Steps**

1. "I need the camera next week." → `set_request` *(item only; "next week"
   cannot be turned into two specific days safely)*
2. `confirm_booking` attempted anyway

**Expected:** the item resolves, the dates do not, clarification is requested by
voice, no token is issued, and nothing is written.

| Check | Expected | Actual | |
|---|---|---|---|
| the request needs clarification | `"needs_clarification"` | `"needs_clarification"` | PASS |
| the item was understood | `"Camera A"` | `"Camera A"` | PASS |
| the dates were not | `null` | `null` | PASS |
| clarification is about dates | `true` | `true` | PASS |
| no confirmation token was issued | `undefined` | `undefined` | PASS |
| confirmation is refused | `"incomplete"` | `"incomplete"` | PASS |
| no reservation was saved | `0` | `0` | PASS |

Database: 1 row → 1 row.

---

## TC07 — Interruption, by ear
*Requirements: R18, R19 — manual*

**Given** the agent is speaking a full sentence aloud.

**Steps** the customer starts talking over it, mid-sentence.

**Expected:** the agent stops within the same turn and does not finish its
sentence over the customer; the interruption is recorded; whatever it was about
to confirm is not saved.

**Actual, 2026-09-14:** verified by ear across three conversations. Nine
interruptions were recorded and the agent stopped each time. `/review` shows the
count per conversation.

Two honest notes:

- On open speakers the agent's own voice reaches the microphone and is treated
  as the customer interrupting. One session recorded 5 false interruptions in 7
  turns. With headphones this drops to the deliberate ones. Headphones are a
  stated requirement for the demo.
- Turns that follow an interruption are reported separately in the latency
  figures. Their timing is real, but it answers "how fast does it recover",
  which is a different question from "how fast does it answer".

---

## Invariant tests underneath

49 tests, run by `npm test`. The ones that matter most:

| Test | Guards against |
|---|---|
| `takes the per-day peak, not the sum of reservations in the range` | the classic availability bug: two non-overlapping bookings summed together, wrongly refusing a booking |
| `treats the day before / after the seeded range as free` | off-by-one on inclusive bounds |
| `lets the database itself reject a second reservation for the same draft` | duplicate bookings surviving a bug in application code |
| `never stores the superseded dates after a correction` | obsolete choices being saved |
| `rejects a token minted before a correction` | a stale confirmation being honoured |
| `leaves exactly one live draft when two requests arrive at once` | a race producing a second draft with an unrotatable token |
| `refuses a draft that belongs to another conversation` | a draft id being treated as a capability |
| `refuses a token whose start date has passed since it was issued` | the calendar moving while a token sits unredeemed |
| `refuses a lookup span longer than the maximum rental` | one request expanding millions of days and blocking the server |
| `falls back to the local file when DATABASE_URL is blank` | every API route returning 500 because an empty string is not undefined |

The last seven exist because an adversarial review, and then a smoke test
against the running server, found each of them after the suite was already
green. Each was confirmed by removing the fix and watching the test fail.
