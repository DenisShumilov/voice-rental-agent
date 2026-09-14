// Turns the token counts the API itself reports into money.
//
// Invariant: nothing here is estimated. Every number comes from a `usage`
// object the provider returned, multiplied by a price with a cited source. If
// no session has been recorded, this returns null rather than a plausible
// figure.

import { PRICING } from '@/config/pricing'

/** The `usage` object attached to a completed response. */
export type RealtimeUsage = {
  total_tokens?: number
  input_tokens?: number
  output_tokens?: number
  input_token_details?: {
    text_tokens?: number
    audio_tokens?: number
    cached_tokens?: number
    cached_tokens_details?: {
      text_tokens?: number
      audio_tokens?: number
    }
  }
  output_token_details?: {
    text_tokens?: number
    audio_tokens?: number
  }
}

export type CostBreakdown = {
  audioInputTokens: number
  cachedAudioInputTokens: number
  textInputTokens: number
  cachedTextInputTokens: number
  audioOutputTokens: number
  textOutputTokens: number
  audioInputUsd: number
  cachedAudioInputUsd: number
  textInputUsd: number
  cachedTextInputUsd: number
  audioOutputUsd: number
  textOutputUsd: number
  transcriptionUsd: number
  totalUsd: number
  responses: number
  minutes: number
  usdPerMinute: number | null
}

/**
 * @param rates which tier to price the same token counts at. Defaults to the
 * tier we actually run; passing the full tier prices the model choice instead
 * of asserting it. Transcription is billed per minute either way, so the two
 * figures stay comparable.
 */
export function calculateCost(
  usages: RealtimeUsage[],
  minutes: number,
  rates: typeof PRICING.realtimeMini | typeof PRICING.realtimeFull = PRICING.realtimeMini,
): CostBreakdown | null {
  if (usages.length === 0) return null

  const totals = {
    audioInput: 0,
    cachedAudioInput: 0,
    textInput: 0,
    cachedTextInput: 0,
    audioOutput: 0,
    textOutput: 0,
  }

  for (const usage of usages) {
    const input = usage.input_token_details ?? {}
    const output = usage.output_token_details ?? {}
    const cachedDetails = input.cached_tokens_details ?? {}

    // Cached tokens are a SUBSET of the input counts, not an addition, so they
    // are subtracted out before the uncached rate is applied.
    const cachedAudio = cachedDetails.audio_tokens ?? 0
    const cachedText = cachedDetails.text_tokens ?? 0

    totals.cachedAudioInput += cachedAudio
    totals.cachedTextInput += cachedText
    totals.audioInput += Math.max(0, (input.audio_tokens ?? 0) - cachedAudio)
    totals.textInput += Math.max(0, (input.text_tokens ?? 0) - cachedText)
    totals.audioOutput += output.audio_tokens ?? 0
    totals.textOutput += output.text_tokens ?? 0
  }

  const perMillion = (tokens: number, rate: number) => (tokens / 1_000_000) * rate

  const audioInputUsd = perMillion(totals.audioInput, rates.audioInput)
  const cachedAudioInputUsd = perMillion(totals.cachedAudioInput, rates.audioInputCached)
  const textInputUsd = perMillion(totals.textInput, rates.textInput)
  const cachedTextInputUsd = perMillion(totals.cachedTextInput, rates.textInputCached)
  const audioOutputUsd = perMillion(totals.audioOutput, rates.audioOutput)
  const textOutputUsd = perMillion(totals.textOutput, rates.textOutput)

  // Transcribing what the customer said is billed separately, per minute of
  // audio, and belongs in the full voice-stack figure.
  const transcriptionUsd = minutes * PRICING.transcription.usdPerMinute

  const totalUsd =
    audioInputUsd +
    cachedAudioInputUsd +
    textInputUsd +
    cachedTextInputUsd +
    audioOutputUsd +
    textOutputUsd +
    transcriptionUsd

  return {
    audioInputTokens: totals.audioInput,
    cachedAudioInputTokens: totals.cachedAudioInput,
    textInputTokens: totals.textInput,
    cachedTextInputTokens: totals.cachedTextInput,
    audioOutputTokens: totals.audioOutput,
    textOutputTokens: totals.textOutput,
    audioInputUsd,
    cachedAudioInputUsd,
    textInputUsd,
    cachedTextInputUsd,
    audioOutputUsd,
    textOutputUsd,
    transcriptionUsd,
    totalUsd,
    responses: usages.length,
    minutes,
    usdPerMinute: minutes > 0 ? totalUsd / minutes : null,
  }
}
