// Expected results were written before the implementation was run.
//
// Fixture: Camera A has 2 units, with 1 unit already booked
// 10-12 October 2026 inclusive. Tripod B has 3 units, Microphone C has 1.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { closeDb, getDb } from '@/lib/db'
import { eachDayInclusive, getAvailability } from '@/lib/availability'
import { resetDatabase } from '@/lib/reset'

beforeAll(async () => {
  process.env.DATABASE_URL = 'file:./data/test-availability.db'
  await resetDatabase()
})

afterAll(() => {
  closeDb()
})

describe('getAvailability', () => {
  it('reports 1 of 2 Camera A free across the seeded range', async () => {
    const result = await getAvailability('camera_a', '2026-10-10', '2026-10-12')

    expect(result.totalStock).toBe(2)
    expect(result.peakUsed).toBe(1)
    expect(result.available).toBe(1)
    expect(result.perDay).toHaveLength(3)
  })

  it('reports both Camera A free after the seeded range ends', async () => {
    const result = await getAvailability('camera_a', '2026-10-13', '2026-10-15')

    expect(result.available).toBe(2)
    expect(result.peakUsed).toBe(0)
  })

  it('treats the day before the seeded range as free (inclusive start)', async () => {
    const result = await getAvailability('camera_a', '2026-10-09', '2026-10-09')

    expect(result.available).toBe(2)
  })

  it('treats the day after the seeded range as free (inclusive end)', async () => {
    const result = await getAvailability('camera_a', '2026-10-13', '2026-10-13')

    expect(result.available).toBe(2)
  })

  it('counts a partial overlap: the last seeded day still occupies a unit', async () => {
    const result = await getAvailability('camera_a', '2026-10-12', '2026-10-14')

    expect(result.available).toBe(1)
    expect(result.perDay).toEqual([
      { date: '2026-10-12', used: 1 },
      { date: '2026-10-13', used: 0 },
      { date: '2026-10-14', used: 0 },
    ])
  })

  it('reports full stock for an item with no reservations', async () => {
    const result = await getAvailability('tripod_b', '2026-10-15', '2026-10-17')

    expect(result.available).toBe(3)
  })

  it('reports the single Microphone C as free', async () => {
    const result = await getAvailability('mic_c', '2026-10-20', '2026-10-22')

    expect(result.available).toBe(1)
  })

  // The trap. A naive implementation sums every reservation overlapping the
  // requested range and answers 1. The correct answer is 2, because the two
  // bookings never share a single day and so never compete for a unit.
  it('takes the per-day peak, not the sum of reservations in the range', async () => {
    await getDb().batch(
      [
        {
          sql: `INSERT INTO reservations
                  (id, item_id, quantity, start_date, end_date, status, source, draft_id, created_at)
                VALUES (?, 'tripod_b', 1, '2026-11-01', '2026-11-02', 'confirmed', 'test', NULL, ?)`,
          args: ['peak-test-a', new Date().toISOString()],
        },
        {
          sql: `INSERT INTO reservations
                  (id, item_id, quantity, start_date, end_date, status, source, draft_id, created_at)
                VALUES (?, 'tripod_b', 1, '2026-11-05', '2026-11-06', 'confirmed', 'test', NULL, ?)`,
          args: ['peak-test-b', new Date().toISOString()],
        },
      ],
      'write',
    )

    const result = await getAvailability('tripod_b', '2026-11-01', '2026-11-06')

    expect(result.peakUsed).toBe(1)
    expect(result.available).toBe(2)
  })
})

describe('eachDayInclusive', () => {
  it('includes both endpoints', () => {
    expect(eachDayInclusive('2026-10-10', '2026-10-12')).toEqual([
      '2026-10-10',
      '2026-10-11',
      '2026-10-12',
    ])
  })

  it('rejects a range that ends before it starts', () => {
    expect(() => eachDayInclusive('2026-10-15', '2026-10-13')).toThrow(RangeError)
  })
})
