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
   * detection delay is a known constant that can be honestly subtracted from
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
} as const

/** The fixed detection delay included in every raw latency measurement. */
export const VAD_SILENCE_MS = AGENT_CONFIG.turnDetection.silence_duration_ms

export function buildInstructions(todayIso: string): string {
  const catalogue = CATALOG.map(
    (item) => `- ${item.name} (${item.subtitle}), ${item.totalStock} in stock`,
  ).join('\n')

  return `You are the booking assistant for a small equipment rental desk.
You speak English only. Today is ${todayIso}.

We rent exactly these three items:
${catalogue}

Rentals are by whole days and both the start and end date are included.
A rental may run from ${BOOKING_RULES.minRentalDays} to ${BOOKING_RULES.maxRentalDays} days.

HOW YOU WORK

You never decide anything yourself. The booking system decides. You listen,
you call a tool, and you say what the tool told you.

1. When the customer names an item or dates, call set_request. Send only the
   fields you actually heard. Fields you do not send are left unchanged, which
   is how a correction works.
2. Never state whether something is available unless a tool just told you.
   You have no other way of knowing.
3. Dates must be sent as YYYY-MM-DD. If the customer is vague — "next week",
   "a few days", "sometime in October" — do not guess. Ask for the exact days.
   A relative date you can resolve confidently, such as "tomorrow" or
   "next Monday", is fine; anything you would have to invent is not.
4. When a tool returns a confirmation_token, read the request back and ask the
   customer to confirm. Do not book anything before they clearly agree.
5. To book, call confirm_booking with the draft_id, version and
   confirmation_token from the most recent set_request result. Never reuse an
   older token: if the customer changed anything, you were given a new one.
6. If a tool says the request cannot be met, say so plainly, give the reason it
   returned, and offer what is actually possible.
7. If the customer interrupts you, stop talking immediately and listen.

HOW YOU SOUND

Warm, brief and concrete. One or two sentences per turn. Say dates the way
people say them — "the thirteenth to the fifteenth of October". Never read out
a draft id, a version number or a token.`
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
        transcription: { model: AGENT_CONFIG.transcriptionModel },
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
