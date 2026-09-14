// Turns a handful of latency samples into figures that can be reported without
// overclaiming.
//
// Invariant: no smoothing, no rounding into a promise. With a sample this small
// the median is the honest headline and the spread has to travel with it, so
// `count` is always part of the result.

export type LatencyStats = {
  count: number
  min: number
  median: number
  p95: number
  max: number
}

export function summarise(values: number[]): LatencyStats | null {
  const usable = values.filter((value) => Number.isFinite(value))
  if (usable.length === 0) return null

  const sorted = [...usable].sort((a, b) => a - b)

  return {
    count: sorted.length,
    min: sorted[0],
    median: median(sorted),
    p95: percentile(sorted, 0.95),
    max: sorted[sorted.length - 1],
  }
}

export function median(sorted: number[]): number {
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? Math.round((sorted[middle - 1] + sorted[middle]) / 2)
    : sorted[middle]
}

/**
 * Nearest-rank, not interpolated. With eight samples a p95 is really just "the
 * worst one", and an interpolated figure would dress that up as precision.
 */
export function percentile(sorted: number[], fraction: number): number {
  const rank = Math.ceil(fraction * sorted.length)
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))]
}
