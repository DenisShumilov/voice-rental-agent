// Brand identity and every word shown on the storefront.
// Invariant: this is the ONLY place the brand name and page copy appear.

export const BRAND = {
  name: 'Aperture Rentals',
  headline: 'Pro gear, booked by voice.',
  subheadline:
    'Three items, one conversation. Tell the agent what you need and when — it checks the calendar while you talk.',
  startCta: 'Start talking',
  stopCta: 'End conversation',
  reassurance: 'No card required · Cancel any time before pickup',
  shelfHeading: 'On the shelf',
} as const

/**
 * Three short facts under the hero. Real rental businesses lead with the
 * operational reassurance a renter actually worries about, not with features.
 */
export const TRUST_FACTS = [
  'Tested and insured before every rental',
  'Same-day pickup from the counter',
  'Cancel any time before pickup',
] as const

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
  thinking: 'Checking the calendar…',
  speaking: 'Speaking',
} as const
