// Every word shown on the storefront.
// Invariant: this is the ONLY place page copy appears.
//
// Deliberately plain. The brief supplies the problem — "a small equipment
// rental desk" — and says a different business need not be invented, so there
// is no trade name here, no day rate, and no claim about how the desk operates.
// Nothing on the page asserts anything that was not specified or measured.

export const COPY = {
  name: 'Equipment rental desk',
  headline: 'Book equipment by voice.',
  subheadline:
    'Three items, whole days, one conversation at a time. Say what you need and when — the agent checks the real calendar while you talk, and books nothing until you confirm.',
  startCta: 'Start talking',
  stopCta: 'End conversation',
  // Shown before the first turn: on laptop speakers the agent hears itself and
  // interrupts its own answer, which reads as a bug rather than as barge-in.
  micHint: 'Headphones recommended — you can interrupt at any time.',
  shelfHeading: 'Inventory',
  bookedHeading: 'Booked in this conversation',
} as const

/** The example shown before the first turn. Built from the catalogue so that
 *  renaming an item does not leave a stale name on the page. */
export function exampleUtterance(itemName: string): string {
  return `I need one ${itemName} from October 13 to 15.`
}

/** What the panel says in each state of the conversation. */
export const VOICE_STATE_COPY = {
  idle: 'Tap to talk',
  connecting: 'Connecting…',
  listening: 'Listening',
  thinking: 'Thinking…',
  speaking: 'Speaking',
} as const
