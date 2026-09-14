// Provider prices used to turn measured token counts into money.
// Invariant: this is the ONLY place a price appears, and every figure carries
// the page it was read from. A price without a source is a guess.
//
// All figures verified against the live pricing page on 2026-09-14.
// https://developers.openai.com/api/docs/pricing

export const PRICING = {
  verifiedOn: '2026-09-14',
  source: 'https://developers.openai.com/api/docs/pricing',

  /** gpt-realtime-2.1-mini, USD per 1,000,000 tokens. */
  realtimeMini: {
    model: 'gpt-realtime-2.1-mini',
    audioInput: 10.0,
    audioInputCached: 0.3,
    audioOutput: 20.0,
    textInput: 0.6,
    textInputCached: 0.06,
    textOutput: 2.4,
  },

  /**
   * The full tier, kept so the quality/cost tradeoff can be priced rather than
   * asserted. Same units.
   */
  realtimeFull: {
    model: 'gpt-realtime-2.1',
    audioInput: 32.0,
    audioInputCached: 0.4,
    audioOutput: 64.0,
    textInput: 4.0,
    textInputCached: 0.4,
    textOutput: 24.0,
  },

  /**
   * Input transcription runs separately from the speech-to-speech model and is
   * billed per minute of audio. Shown on the pricing page in an "Estimated
   * cost" column rather than as a token rate.
   */
  transcription: {
    model: 'gpt-transcribe',
    usdPerMinute: 0.0045,
  },

  /**
   * A same-vendor sanity anchor: OpenAI's separate full-duplex voice model is
   * billed at a flat per-minute rate. If our computed figure lands wildly
   * outside this, the computation is wrong.
   */
  anchor: {
    model: 'gpt-live-1',
    usdPerMinute: 0.05,
  },
} as const

/** Monthly hosting, reported separately from per-conversation API cost. */
export const HOSTING = {
  current: [
    { item: 'Vercel Hobby', usdPerMonth: 0, note: 'Non-commercial use only' },
    { item: 'Turso Free', usdPerMonth: 0, note: '5 GB, 500M row reads per month' },
  ],
  ifRunCommercially: [
    { item: 'Vercel Pro', usdPerMonth: 20, note: 'Required for any commercial deployment' },
    { item: 'Turso Developer', usdPerMonth: 5.99, note: 'Billed monthly' },
  ],
} as const
