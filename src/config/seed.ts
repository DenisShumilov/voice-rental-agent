// Reservations that already exist the moment the database is created.
// Invariant: this is the ONLY place seeded booking dates appear.
//
// Required by the brief: one existing Camera A booking for
// 10-12 October 2026, inclusive. That leaves 1 of 2 Camera A units free
// on those three days.

export type SeedReservation = {
  id: string
  itemId: string
  quantity: number
  /** ISO date, inclusive. */
  startDate: string
  /** ISO date, inclusive. */
  endDate: string
}

export const SEED_RESERVATIONS: SeedReservation[] = [
  {
    id: 'seed-camera-a-october',
    itemId: 'camera_a',
    quantity: 1,
    startDate: '2026-10-10',
    endDate: '2026-10-12',
  },
]
