// The statistics behind every latency figure a reviewer reads.
//
// Nothing here talks to a database or a network: these are the four lines of
// arithmetic that turn samples into the headline, and if they are wrong every
// number in README.md, DELIVERY_NOTES.md and /review is wrong with them.

import { describe, expect, it } from 'vitest'

import { median, percentile, summarise } from '@/lib/metrics'

describe('summarise', () => {
  it('returns null rather than a plausible figure when there is nothing to report', () => {
    expect(summarise([])).toBeNull()
    expect(summarise([Number.NaN, Number.POSITIVE_INFINITY])).toBeNull()
  })

  it('reports the count alongside the median, so the sample size travels with it', () => {
    const stats = summarise([900, 1100, 1000])
    expect(stats).toEqual({ count: 3, min: 900, median: 1000, p95: 1100, max: 1100 })
  })

  it('drops readings that are not finite instead of poisoning the median', () => {
    const stats = summarise([1000, Number.NaN, 1200, Number.POSITIVE_INFINITY, 800])
    expect(stats?.count).toBe(3)
    expect(stats?.median).toBe(1000)
  })

  it('does not reorder the caller\u2019s array', () => {
    const samples = [300, 100, 200]
    summarise(samples)
    expect(samples).toEqual([300, 100, 200])
  })

  it('handles one sample without pretending to a spread', () => {
    expect(summarise([1234])).toEqual({
      count: 1,
      min: 1234,
      median: 1234,
      p95: 1234,
      max: 1234,
    })
  })
})

describe('median', () => {
  it('averages the two middle values on an even count', () => {
    expect(median([10, 20, 30, 40])).toBe(25)
  })

  it('takes the middle value on an odd count', () => {
    expect(median([10, 20, 30])).toBe(20)
  })

  it('rounds the even case to a whole millisecond', () => {
    expect(median([10, 11])).toBe(11)
  })
})

describe('percentile', () => {
  it('is nearest-rank, not interpolated', () => {
    // With eight samples the 95th percentile is really just "the worst one".
    // An interpolated figure would dress that up as precision we do not have.
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8]
    expect(percentile(sorted, 0.95)).toBe(8)
    expect(percentile(sorted, 0.5)).toBe(4)
  })

  it('never reads past either end of the sample', () => {
    const sorted = [5, 6, 7]
    expect(percentile(sorted, 1)).toBe(7)
    expect(percentile(sorted, 0)).toBe(5)
  })
})
