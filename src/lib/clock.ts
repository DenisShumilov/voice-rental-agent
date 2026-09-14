// The one place the current date comes from.
// Invariant: no other module calls `new Date()` for "today". Tests pin the
// clock so that "is this date in the past?" does not change answer next month.

let frozenAt: string | null = null

export function now(): Date {
  return frozenAt ? new Date(`${frozenAt}T12:00:00.000Z`) : new Date()
}

/** Today as YYYY-MM-DD, in UTC. */
export function today(): string {
  return now().toISOString().slice(0, 10)
}

/** Pins "today" to a fixed date. Pass null to return to the real clock. */
export function freezeClock(date: string | null): void {
  frozenAt = date
}
