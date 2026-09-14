// Answers one question: how many units of an item are free on EVERY day of an
// inclusive date range.
//
// Invariant: availability is the MINIMUM free units across all days in the
// range — total stock minus the PEAK daily committed quantity. It is never the
// sum of reservations overlapping the range, because two reservations that do
// not overlap each other never compete for the same unit.

import { getDb, type SqlExecutor } from './db'
import { getItem } from '@/config/catalog'

const DAY_MS = 86_400_000
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export type DayUsage = {
  date: string
  used: number
}

export type Availability = {
  itemId: string
  startDate: string
  endDate: string
  totalStock: number
  /** Highest quantity committed on any single day in the range. */
  peakUsed: number
  /** totalStock - peakUsed, floored at zero. */
  available: number
  perDay: DayUsage[]
}

type OverlappingRow = {
  quantity: number
  start_date: string
  end_date: string
}

/** Whole days from `from` to `to`. Negative when `to` is earlier. */
export function differenceInDays(from: string, to: string): number {
  assertIsoDate(from)
  assertIsoDate(to)
  return (toUtcMillis(to) - toUtcMillis(from)) / DAY_MS
}

/** True when the string is a real calendar date in YYYY-MM-DD form. */
export function isCalendarDate(value: string): boolean {
  try {
    assertIsoDate(value)
    return true
  } catch {
    return false
  }
}

/** Every date from start to end, both endpoints included. */
export function eachDayInclusive(startDate: string, endDate: string): string[] {
  assertIsoDate(startDate)
  assertIsoDate(endDate)

  const start = toUtcMillis(startDate)
  const end = toUtcMillis(endDate)
  if (start > end) {
    throw new RangeError(`start_date ${startDate} is after end_date ${endDate}`)
  }

  const days: string[] = []
  for (let ms = start; ms <= end; ms += DAY_MS) {
    days.push(fromUtcMillis(ms))
  }
  return days
}

export async function getAvailability(
  itemId: string,
  startDate: string,
  endDate: string,
  options: { excludeDraftId?: string; executor?: SqlExecutor } = {},
): Promise<Availability> {
  const item = getItem(itemId)
  if (!item) throw new Error(`Unknown item: ${itemId}`)

  const days = eachDayInclusive(startDate, endDate)

  // Fetch only reservations that touch the requested window. Anything outside
  // it contributes zero to every day inside it, so it cannot change the peak.
  const sql = options.excludeDraftId
    ? `SELECT quantity, start_date, end_date FROM reservations
       WHERE item_id = ? AND status = 'confirmed'
         AND start_date <= ? AND end_date >= ?
         AND (draft_id IS NULL OR draft_id <> ?)`
    : `SELECT quantity, start_date, end_date FROM reservations
       WHERE item_id = ? AND status = 'confirmed'
         AND start_date <= ? AND end_date >= ?`

  const args = options.excludeDraftId
    ? [itemId, endDate, startDate, options.excludeDraftId]
    : [itemId, endDate, startDate]

  const executor = options.executor ?? getDb()
  const result = await executor.execute({ sql, args })
  const rows = result.rows as unknown as OverlappingRow[]

  const perDay: DayUsage[] = days.map((date) => ({
    date,
    used: rows.reduce(
      (total, row) =>
        row.start_date <= date && date <= row.end_date
          ? total + Number(row.quantity)
          : total,
      0,
    ),
  }))

  const peakUsed = perDay.reduce((peak, day) => Math.max(peak, day.used), 0)

  return {
    itemId,
    startDate,
    endDate,
    totalStock: item.totalStock,
    peakUsed,
    available: Math.max(0, item.totalStock - peakUsed),
    perDay,
  }
}

function assertIsoDate(value: string): void {
  if (!ISO_DATE.test(value)) {
    throw new RangeError(`Expected an ISO date (YYYY-MM-DD), got: ${value}`)
  }
  const [year, month, day] = value.split('-').map(Number)
  const asDate = new Date(Date.UTC(year, month - 1, day))
  if (
    asDate.getUTCFullYear() !== year ||
    asDate.getUTCMonth() !== month - 1 ||
    asDate.getUTCDate() !== day
  ) {
    throw new RangeError(`Not a real calendar date: ${value}`)
  }
}

function toUtcMillis(date: string): number {
  const [year, month, day] = date.split('-').map(Number)
  return Date.UTC(year, month - 1, day)
}

function fromUtcMillis(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}
