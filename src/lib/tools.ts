// The three tools the model may call, and the validation in front of them.
//
// Invariant: the model is an untrusted caller. Every argument is parsed by a
// schema before it reaches the booking logic, unknown tools are refused, and
// no tool ever returns a sentence the backend did not decide is true. Results
// carry facts plus guidance on what to do next — never a script to recite.

import { z } from 'zod'

import { getItem, resolveItem } from '@/config/catalog'
import { BOOKING_RULES } from '@/config/rules'
import { differenceInDays, getAvailability, isCalendarDate } from './availability'
import { confirmBooking } from './booking'
import { logEvent } from './events'
import { setRequest, type ClarificationReason } from './drafts'

export const TOOL_NAMES = ['set_request', 'confirm_booking', 'check_availability'] as const
export type ToolName = (typeof TOOL_NAMES)[number]

export type ToolResult = {
  tool: string
  status: string
  facts: Record<string, unknown>
  guidance: string
}

const setRequestArgs = z.object({
  item: z.string().min(1).nullish(),
  quantity: z.coerce.number().int().min(1).nullish(),
  start_date: z.string().min(1).nullish(),
  end_date: z.string().min(1).nullish(),
})

const confirmBookingArgs = z.object({
  draft_id: z.string().min(1),
  version: z.coerce.number().int().min(1),
  confirmation_token: z.string().min(1),
})

const checkAvailabilityArgs = z.object({
  item: z.string().min(1),
  start_date: z.string().min(1),
  end_date: z.string().min(1),
})

export async function dispatchTool(
  sessionId: string,
  tool: string,
  rawArgs: unknown,
): Promise<ToolResult> {
  await logEvent(sessionId, 'tool_call', { tool, args: rawArgs })

  const result = await route(sessionId, tool, rawArgs)

  await logEvent(sessionId, 'tool_result', {
    tool: result.tool,
    status: result.status,
    facts: result.facts,
  })

  return result
}

async function route(
  sessionId: string,
  tool: string,
  rawArgs: unknown,
): Promise<ToolResult> {
  switch (tool) {
    case 'set_request':
      return runSetRequest(sessionId, rawArgs)
    case 'confirm_booking':
      return runConfirmBooking(sessionId, rawArgs)
    case 'check_availability':
      return runCheckAvailability(rawArgs)
    default:
      return {
        tool,
        status: 'unknown_tool',
        facts: { available_tools: TOOL_NAMES },
        guidance: 'That tool does not exist. Use one of the listed tools.',
      }
  }
}

async function runSetRequest(sessionId: string, rawArgs: unknown): Promise<ToolResult> {
  const parsed = setRequestArgs.safeParse(rawArgs ?? {})
  if (!parsed.success) return invalidArguments('set_request', parsed.error)

  const args = parsed.data
  const result = await setRequest(sessionId, {
    item: args.item ?? undefined,
    quantity: args.quantity ?? undefined,
    startDate: args.start_date ?? undefined,
    endDate: args.end_date ?? undefined,
  })

  const { draft, availability, clarificationNeeded, itemCandidates } = result
  const item = draft.itemId ? getItem(draft.itemId) : undefined

  const facts: Record<string, unknown> = {
    draft_id: draft.id,
    version: draft.version,
    item: item?.name ?? null,
    quantity: draft.quantity,
    start_date: draft.startDate,
    end_date: draft.endDate,
    total_stock: availability?.totalStock ?? item?.totalStock ?? null,
    available: availability?.available ?? null,
  }

  if (draft.status === 'available') {
    facts.confirmation_token = draft.confirmationToken
    return {
      tool: 'set_request',
      status: 'available',
      facts,
      guidance:
        'Read the request back to the customer and ask them to confirm. Do not book anything yet.',
    }
  }

  if (draft.status === 'unavailable') {
    return {
      tool: 'set_request',
      status: 'unavailable',
      facts,
      guidance: `Only ${facts.available} of ${facts.total_stock} are free for those dates, so this cannot be booked. Say so and offer what is possible — fewer units, or different dates.`,
    }
  }

  facts.needs = clarificationNeeded
  if (itemCandidates.length > 0) {
    facts.options = itemCandidates.map((candidate) => candidate.name)
  }

  return {
    tool: 'set_request',
    status: 'needs_clarification',
    facts,
    guidance: clarificationGuidance(clarificationNeeded, itemCandidates.map((c) => c.name)),
  }
}

async function runConfirmBooking(
  sessionId: string,
  rawArgs: unknown,
): Promise<ToolResult> {
  const parsed = confirmBookingArgs.safeParse(rawArgs ?? {})
  if (!parsed.success) return invalidArguments('confirm_booking', parsed.error)

  const result = await confirmBooking({
    sessionId,
    draftId: parsed.data.draft_id,
    version: parsed.data.version,
    confirmationToken: parsed.data.confirmation_token,
  })

  const item = result.reservation ? getItem(result.reservation.itemId) : undefined
  const facts: Record<string, unknown> = {
    booking_reference: result.reservation?.id ?? null,
    item: item?.name ?? null,
    quantity: result.reservation?.quantity ?? null,
    start_date: result.reservation?.startDate ?? null,
    end_date: result.reservation?.endDate ?? null,
    remaining_for_those_dates: result.remaining,
  }

  switch (result.outcome) {
    case 'confirmed':
      return {
        tool: 'confirm_booking',
        status: 'confirmed',
        facts,
        guidance:
          'The booking is saved. Confirm it out loud and mention how many units are left for those dates.',
      }
    case 'already_confirmed':
      return {
        tool: 'confirm_booking',
        status: 'already_confirmed',
        facts,
        guidance:
          'This booking already exists and nothing new was saved. Reassure the customer it is booked, once. Do not book again.',
      }
    case 'stale_confirmation':
      return {
        tool: 'confirm_booking',
        status: 'stale_confirmation',
        facts: { current_version: result.draft?.version ?? null },
        guidance:
          'The request changed after that confirmation, so nothing was saved. Read back the current request and ask the customer to confirm it again.',
      }
    case 'not_available':
      return {
        tool: 'confirm_booking',
        status: 'not_available',
        facts: { available: result.remaining },
        guidance:
          'There is not enough stock, so nothing was saved. Tell the customer and offer different dates or fewer units.',
      }
    case 'incomplete':
      return {
        tool: 'confirm_booking',
        status: 'incomplete',
        facts: {},
        guidance:
          'The request is still missing details, so nothing was saved. Ask for what is missing, then set the request again.',
      }
    default:
      return {
        tool: 'confirm_booking',
        status: 'unknown_draft',
        facts: {},
        guidance:
          'There is no request with that reference. Ask the customer what they need and start a new request.',
      }
  }
}

async function runCheckAvailability(rawArgs: unknown): Promise<ToolResult> {
  const parsed = checkAvailabilityArgs.safeParse(rawArgs ?? {})
  if (!parsed.success) return invalidArguments('check_availability', parsed.error)

  const { item, start_date: startDate, end_date: endDate } = parsed.data
  const resolved = resolveItem(item)

  if (resolved.kind !== 'resolved') {
    return {
      tool: 'check_availability',
      status: 'needs_clarification',
      facts: {
        needs: ['item'],
        options:
          resolved.kind === 'ambiguous'
            ? resolved.candidates.map((candidate) => candidate.name)
            : undefined,
      },
      guidance: 'Ask the customer which of the three items they mean.',
    }
  }

  // The span is bounded before it is expanded: getAvailability walks one entry
  // per day, so an unbounded range submitted here would block the server.
  // differenceInDays only parses the two endpoints, so rejecting costs nothing.
  if (
    !isCalendarDate(startDate) ||
    !isCalendarDate(endDate) ||
    startDate > endDate ||
    differenceInDays(startDate, endDate) + 1 > BOOKING_RULES.maxRentalDays
  ) {
    return {
      tool: 'check_availability',
      status: 'needs_clarification',
      facts: { needs: ['dates'], max_rental_days: BOOKING_RULES.maxRentalDays },
      guidance: `Ask the customer for the exact first and last day of the rental. Rentals run for at most ${BOOKING_RULES.maxRentalDays} days.`,
    }
  }

  const availability = await getAvailability(resolved.item.id, startDate, endDate)

  return {
    tool: 'check_availability',
    status: 'ok',
    facts: {
      item: resolved.item.name,
      start_date: startDate,
      end_date: endDate,
      available: availability.available,
      total_stock: availability.totalStock,
    },
    guidance:
      'State how many are free for those dates. This was only a lookup — the current request has not changed.',
  }
}

function clarificationGuidance(
  reasons: ClarificationReason[],
  options: string[],
): string {
  const parts: string[] = []

  if (reasons.includes('item')) {
    parts.push(
      options.length > 0
        ? `Ask which item they mean: ${options.join(' or ')}.`
        : 'Ask which of the three items they want.',
    )
  }
  if (reasons.includes('quantity')) parts.push('Ask how many units they need.')
  if (reasons.includes('dates')) {
    parts.push('Ask for the exact first and last day of the rental. Do not guess.')
  }
  if (reasons.includes('date_range')) {
    parts.push('The end date came before the start date. Ask them to repeat both days.')
  }
  if (reasons.includes('past_dates')) {
    parts.push('That start date has already passed. Ask which dates they actually mean.')
  }
  if (reasons.includes('range_too_short')) {
    parts.push(`Rentals run for at least ${BOOKING_RULES.minRentalDays} day(s).`)
  }
  if (reasons.includes('range_too_long')) {
    parts.push(
      `Rentals run for at most ${BOOKING_RULES.maxRentalDays} days. Ask for a shorter period.`,
    )
  }
  if (reasons.includes('too_far_ahead')) {
    parts.push('We only take bookings up to a year ahead.')
  }

  parts.push('Nothing has been booked.')
  return parts.join(' ')
}

function invalidArguments(tool: string, error: z.ZodError): ToolResult {
  return {
    tool,
    status: 'invalid_arguments',
    facts: {
      problems: error.issues.map((issue) => ({
        field: issue.path.join('.'),
        problem: issue.message,
      })),
    },
    guidance:
      'The arguments were not valid, so nothing happened. Fix them and call the tool again.',
  }
}
