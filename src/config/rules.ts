// Booking rules of the rental desk.
// Invariant: this is the ONLY place these limits appear. Changing "minimum two
// days" or "no more than a month ahead" is a one-line edit here.

export const BOOKING_RULES = {
  /** Assumed when the customer names an item but not a count. */
  defaultQuantity: 1,
  /** Shortest rental, counted in inclusive days. */
  minRentalDays: 1,
  /** Longest rental, counted in inclusive days. */
  maxRentalDays: 30,
  /** How far ahead a rental may start, in days from today. */
  maxAdvanceDays: 365,
} as const
