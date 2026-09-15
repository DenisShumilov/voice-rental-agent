// The arithmetic behind every money figure a reviewer reads.
//
// The trap here is caching. Cached tokens are a SUBSET of the input counts the
// API reports, not an addition — bill them on top and the total silently
// inflates. That is the mistake this file exists to catch.

import { describe, expect, it } from 'vitest'

import { PRICING } from '@/config/pricing'
import { calculateCost, type RealtimeUsage } from '@/lib/cost'

const RATES = PRICING.realtimeMini

/** One response: 10k audio in (4k of it cached), 20k audio out, 100k text in (80k cached). */
const usage: RealtimeUsage = {
  input_token_details: {
    audio_tokens: 10_000,
    text_tokens: 100_000,
    cached_tokens: 84_000,
    cached_tokens_details: { audio_tokens: 4_000, text_tokens: 80_000 },
  },
  output_token_details: { audio_tokens: 20_000, text_tokens: 500 },
}

const perMillion = (tokens: number, rate: number) => (tokens / 1_000_000) * rate

describe('calculateCost', () => {
  it('returns null rather than a zero when nothing was recorded', () => {
    expect(calculateCost([], 10)).toBeNull()
  })

  it('bills cached tokens instead of the uncached ones, not on top of them', () => {
    const cost = calculateCost([usage], 1)!

    // 10,000 audio in of which 4,000 were cached leaves 6,000 at full rate.
    expect(cost.audioInputTokens).toBe(6_000)
    expect(cost.cachedAudioInputTokens).toBe(4_000)
    // 100,000 text in of which 80,000 were cached leaves 20,000 at full rate.
    expect(cost.textInputTokens).toBe(20_000)
    expect(cost.cachedTextInputTokens).toBe(80_000)
  })

  it('charges each bucket at its own published rate', () => {
    const cost = calculateCost([usage], 1)!

    expect(cost.audioInputUsd).toBeCloseTo(perMillion(6_000, RATES.audioInput), 10)
    expect(cost.cachedAudioInputUsd).toBeCloseTo(perMillion(4_000, RATES.audioInputCached), 10)
    expect(cost.textInputUsd).toBeCloseTo(perMillion(20_000, RATES.textInput), 10)
    expect(cost.cachedTextInputUsd).toBeCloseTo(perMillion(80_000, RATES.textInputCached), 10)
    expect(cost.audioOutputUsd).toBeCloseTo(perMillion(20_000, RATES.audioOutput), 10)
    expect(cost.textOutputUsd).toBeCloseTo(perMillion(500, RATES.textOutput), 10)
  })

  it('bills transcription by the minute, separately from the model', () => {
    const cost = calculateCost([usage], 4)!
    expect(cost.transcriptionUsd).toBeCloseTo(4 * PRICING.transcription.usdPerMinute, 10)
  })

  it('reports a total that is exactly the sum of the rows it prints', () => {
    const cost = calculateCost([usage, usage], 2)!
    const rows =
      cost.audioInputUsd +
      cost.cachedAudioInputUsd +
      cost.textInputUsd +
      cost.cachedTextInputUsd +
      cost.audioOutputUsd +
      cost.textOutputUsd +
      cost.transcriptionUsd

    expect(cost.totalUsd).toBeCloseTo(rows, 12)
  })

  it('adds up across responses and counts them', () => {
    const one = calculateCost([usage], 1)!
    const two = calculateCost([usage, usage], 1)!

    expect(two.responses).toBe(2)
    expect(two.audioOutputTokens).toBe(2 * one.audioOutputTokens)
    // Transcription is per minute, so only the token-priced part doubles.
    expect(two.totalUsd - two.transcriptionUsd).toBeCloseTo(
      2 * (one.totalUsd - one.transcriptionUsd),
      10,
    )
  })

  it('refuses a per-minute figure when there are no minutes to divide by', () => {
    expect(calculateCost([usage], 0)!.usdPerMinute).toBeNull()
  })

  it('survives a usage object with fields missing', () => {
    const cost = calculateCost([{}, { input_token_details: {} }], 1)!
    expect(cost.responses).toBe(2)
    expect(cost.audioInputTokens).toBe(0)
    expect(cost.totalUsd).toBeCloseTo(PRICING.transcription.usdPerMinute, 10)
  })

  it('never reports a negative bucket when the API says more was cached than sent', () => {
    const odd: RealtimeUsage = {
      input_token_details: {
        audio_tokens: 100,
        cached_tokens: 500,
        cached_tokens_details: { audio_tokens: 500 },
      },
    }
    expect(calculateCost([odd], 1)!.audioInputTokens).toBe(0)
  })

  it('prices the tier we did not choose higher on identical tokens', () => {
    const mini = calculateCost([usage], 1)!
    const full = calculateCost([usage], 1, PRICING.realtimeFull)!

    expect(full.totalUsd).toBeGreaterThan(mini.totalUsd)
    // Same tokens either way — only the rates differ.
    expect(full.audioOutputTokens).toBe(mini.audioOutputTokens)
    expect(full.transcriptionUsd).toBeCloseTo(mini.transcriptionUsd, 12)
  })
})
