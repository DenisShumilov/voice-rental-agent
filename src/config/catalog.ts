// The complete equipment catalogue: names, stock levels and the spoken
// phrases that map to each item.
// Invariant: this is the ONLY place item names and stock levels appear.
// Adding an item or changing stock is a one-line edit here, then `npm run reset-db`.

/** Product photos: Unsplash, whose licence permits commercial use without
 *  attribution. Each was opened and checked before being used. */
export type CatalogItem = {
  id: string
  sku: string
  name: string
  subtitle: string
  specs: string
  /** Day rate. Within the range real gear-rental houses charge for this class. */
  pricePerDay: number
  totalStock: number
  /** Optional photo URL. Falls back to a typographic tile when absent. */
  image?: string
  /** Lowercase phrases a customer might say for this item. */
  aliases: string[]
}

export const CATALOG: CatalogItem[] = [
  {
    id: 'camera_a',
    sku: 'CAM-A',
    name: 'Camera A',
    subtitle: 'Digital SLR body',
    specs: '24 MP · 1080p60 · EF mount',
    pricePerDay: 75,
    totalStock: 2,
    image: 'https://images.unsplash.com/photo-1502920917128-1aa500764cbd?w=800&h=600&fit=crop&q=75&auto=format',
    aliases: ['camera a', 'cam a', 'camera', 'mirrorless', 'body'],
  },
  {
    id: 'tripod_b',
    sku: 'TRI-B',
    name: 'Tripod B',
    subtitle: 'Carbon fibre tripod',
    specs: '1.6 m · fluid ball head · 12 kg load',
    pricePerDay: 35,
    totalStock: 3,
    image: 'https://images.unsplash.com/photo-1594147216879-97803adfb44d?w=800&h=600&fit=crop&q=75&auto=format',
    aliases: ['tripod b', 'tripod', 'stand', 'legs'],
  },
  {
    id: 'mic_c',
    sku: 'MIC-C',
    name: 'Microphone C',
    subtitle: 'Handheld condenser',
    specs: 'XLR · supercardioid · windshield',
    pricePerDay: 30,
    totalStock: 1,
    image: 'https://images.unsplash.com/photo-1521424159246-e4a66f267e4b?w=800&h=600&fit=crop&q=75&auto=format',
    aliases: ['microphone c', 'mic c', 'microphone', 'mic', 'shotgun'],
  },
]

export function getItem(itemId: string): CatalogItem | undefined {
  return CATALOG.find((item) => item.id === itemId)
}

export type ResolveResult =
  | { kind: 'resolved'; item: CatalogItem }
  | { kind: 'ambiguous'; candidates: CatalogItem[] }
  | { kind: 'not_found' }

/**
 * Maps a spoken phrase onto exactly one catalogue item.
 * Returns `ambiguous` rather than guessing when more than one item matches —
 * the agent must then ask, and no draft gets dates it cannot justify.
 */
export function resolveItem(spoken: string): ResolveResult {
  const text = normalise(spoken)
  if (text.length === 0) return { kind: 'not_found' }

  const matches = CATALOG.filter((item) => {
    const needles = [item.id, item.sku, item.name, ...item.aliases]
    return needles.some((needle) => containsPhrase(text, normalise(needle)))
  })

  if (matches.length === 1) return { kind: 'resolved', item: matches[0] }
  if (matches.length > 1) return { kind: 'ambiguous', candidates: matches }
  return { kind: 'not_found' }
}

function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/[_-]/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Whole-phrase match, so "a" inside "camera" never counts as a hit. */
function containsPhrase(haystack: string, needle: string): boolean {
  if (needle.length === 0) return false
  return ` ${haystack} `.includes(` ${needle} `)
}
