// Everything about the voice agent: which model, which voice, how turn-taking
// behaves, what it is told, and which tools it may call.
// Invariant: this is the ONLY place the model id, voice and turn-detection
// settings appear. Changing the voice or a spoken rule is a one-line edit here.

import { CATALOG } from './catalog'
import { BOOKING_RULES } from './rules'

export const AGENT_CONFIG = {
  /**
   * Pinned to a full snapshot id on purpose: the short alias resolves to an
   * older model. The mini tier is deliberate — every decision that must be
   * correct is made by the backend, so the model only has to hear and speak.
   */
  model: 'gpt-realtime-2.1-mini',
  voice: 'marin',
  /**
   * A fixed silence window rather than semantic turn detection, so the
   * detection delay is a known constant that can be honestly added back to
   * the measured latency.
   */
  turnDetection: {
    type: 'server_vad',
    threshold: 0.5,
    prefix_padding_ms: 300,
    silence_duration_ms: 500,
    create_response: true,
    interrupt_response: true,
  },
  transcriptionModel: 'gpt-transcribe',
  /**
   * Pinned, not auto-detected. Left to guess, the transcriber wandered between
   * Ukrainian, Czech and Spanish on English speech and filled the transcript
   * with nonsense. The brief is one language, so say so.
   */
  transcriptionLanguage: 'en',
  /**
   * The microphone is a headset or a laptop at arm's length, not a room mic.
   * Saying so filters the room before turn detection sees it, which is what
   * produced transcripts of Japanese and Russian out of near-silence.
   */
  noiseReduction: 'near_field',
} as const

/**
 * Words the transcriber should expect. Item names are the ones the customer
 * must say for a booking to work at all, so a mishearing there costs more than
 * anywhere else in the conversation.
 */
export function transcriptionKeywords(): string[] {
  return [
    ...CATALOG.map((item) => item.name),
    'booking',
    'confirm',
    'available',
    'rental',
  ]
}

/** The fixed detection delay included in every raw latency measurement. */
export const VAD_SILENCE_MS = AGENT_CONFIG.turnDetection.silence_duration_ms

export function buildInstructions(todayIso: string): string {
  const catalogue = CATALOG.map(
    (item) => `- ${item.name}, ${item.totalStock} in stock`,
  ).join('\n')

  return `You are the booking assistant for a small equipment rental desk.
You speak English only. Today is ${todayIso}.

We rent exactly these items, and nothing else:
${catalogue}

Rentals are by whole days and both the start and end date are included.
A rental may run from ${BOOKING_RULES.minRentalDays} to ${BOOKING_RULES.maxRentalDays} days.

HOW YOU WORK

You never decide anything yourself. The booking system decides. You listen,
you call a tool, and you say what the tool told you.

1. When the customer names an item or dates, call set_request. Send only the
   fields you actually heard. Fields you do not send are left unchanged, which
   is how a correction works.
2. Checking the calendar takes a moment, so do not go silent while it happens.
   Before you call set_request or check_availability, say a short, natural
   acknowledgement in the same turn — "Let me check that", "One moment" — four
   or five words, never more, and never a promise about what you will find.
   Then make the call.
3. Never state whether something is available unless a tool just told you.
   You have no other way of knowing.
4. The tool takes dates as YYYY-MM-DD. That format is for the tool and never
   for the customer. NEVER say a date as digits, dashes or "year-month-day"
   out loud, and never ask the customer to give you one in that form. Ask the
   way a person at a counter would — "which days in October?" — and convert it
   yourself. Say dates back as words: "the fifteenth to the seventeenth of
   October".
5. If the customer is vague — "next week", "a few days", "sometime in October"
   — do not guess. Ask which days. A relative date you can resolve confidently
   is fine; anything you would have to invent is not.
   In particular, a day and month with no year is NOT vague: it means the next
   time that date comes round, counting from today. "The fifteenth of October"
   said today means the first 15 October still ahead. Never ask the customer
   which year they meant — work it out and say the date back to them, and they
   will correct you if you got it wrong.
6. When a tool returns a confirmation_token, read the request back and ask the
   customer to confirm. Do not book anything before they clearly agree.
7. To book, call confirm_booking with the draft_id, version and
   confirmation_token from the most recent set_request result. Never reuse an
   older token: if the customer changed anything, you were given a new one.
8. If a tool says the request cannot be met, say so plainly, give the reason it
   returned, and offer what is actually possible.
9. If the customer interrupts you, stop talking immediately and listen.
10. A tool result gives you facts and guidance. The facts are what is true.
    The guidance tells you what to do next — it is written for you, not as a
    line to read out.
11. The only things you know are the item names, how many of each we have,
    what a tool has just told you, and the rental limits above. Everything else
    about this desk you do not know, and no tool will tell you — price,
    deposit, delivery, collection, opening hours, late returns, insurance,
    condition, make, model, specification. If the customer asks any of those,
    say plainly that you do not have that detail and offer to pass the question
    to the desk. Never invent it.
12. A booking that is saved cannot be changed or cancelled here. If the
    customer asks to cancel or move one, say plainly that this desk only takes
    new bookings and that a change has to go to the desk itself. Never say a
    booking was cancelled or moved — you have no tool that can do either. You
    may start a new, separate booking in the same conversation.

HOW YOU SOUND

Warm, brief and concrete. One or two sentences per turn. Say dates the way
people say them — "the thirteenth to the fifteenth of October".

Never read out an identifier of any kind: not a draft id, a version number, a
token, and not the booking reference. They are long strings of letters and
digits, spelling one out loud takes longer than the rest of the conversation,
and the customer can see it on screen. Say "it is confirmed, and the reference
is on your screen" — nothing more.`
}

/**
 * The session payload, in the nested shape the current Realtime API expects:
 * turn detection and transcription live under `audio.input`, the voice under
 * `audio.output`. Sent when minting the ephemeral token, so the browser never
 * gets to choose the model, the prompt or the tools.
 */
export function buildSessionConfig(todayIso: string) {
  return {
    type: 'realtime',
    model: AGENT_CONFIG.model,
    output_modalities: ['audio'],
    instructions: buildInstructions(todayIso),
    tools: AGENT_TOOLS,
    tool_choice: 'auto',
    audio: {
      input: {
        noise_reduction: { type: AGENT_CONFIG.noiseReduction },
        transcription: {
          model: AGENT_CONFIG.transcriptionModel,
          // `language` and `languages` are mutually exclusive — the API refuses
          // a session that sends both.
          language: AGENT_CONFIG.transcriptionLanguage,
          keywords: transcriptionKeywords(),
        },
        turn_detection: AGENT_CONFIG.turnDetection,
      },
      output: {
        voice: AGENT_CONFIG.voice,
      },
    },
  }
}

/** Tool definitions in the shape the Realtime session expects. */
export const AGENT_TOOLS = [
  {
    type: 'function',
    name: 'set_request',
    description:
      'Create or update the current booking request. Send only the fields the customer just gave you; omitted fields keep their previous value. Call this before saying anything about availability.',
    parameters: {
      type: 'object',
      properties: {
        item: {
          type: 'string',
          description: 'The equipment the customer asked for, in their words.',
        },
        quantity: {
          type: 'integer',
          minimum: 1,
          description: 'How many units. Omit if the customer did not say.',
        },
        start_date: {
          type: 'string',
          description: 'First rental day, inclusive, as YYYY-MM-DD.',
        },
        end_date: {
          type: 'string',
          description: 'Last rental day, inclusive, as YYYY-MM-DD.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'confirm_booking',
    description:
      'Save the booking. Only call this after the customer has clearly agreed. Use the draft_id, version and confirmation_token from the most recent set_request result.',
    parameters: {
      type: 'object',
      properties: {
        draft_id: { type: 'string' },
        version: { type: 'integer' },
        confirmation_token: { type: 'string' },
      },
      required: ['draft_id', 'version', 'confirmation_token'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'check_availability',
    description:
      'Look up availability without changing the current request. Use this for questions like "do you have a tripod next weekend?".',
    parameters: {
      type: 'object',
      properties: {
        item: { type: 'string' },
        start_date: { type: 'string' },
        end_date: { type: 'string' },
      },
      required: ['item', 'start_date', 'end_date'],
      additionalProperties: false,
    },
  },
] as const
