// The complete equipment catalogue: names, stock levels and the spoken
// phrases that map to each item.
// Invariant: this is the ONLY place item names and stock levels appear.
// Adding an item or changing stock is a one-line edit here, then `npm run reset-db`.

/** Product photographs live in public/ and are referenced by path. They were
 *  generated for this project as one consistent set — same backdrop, light and
 *  angle — rather than assembled from stock, which never matches. They depict
 *  no real product, carry no branding, and make no claim about the equipment:
 *  the card states the item name and the stock count, nothing else. A missing
 *  file degrades to a tile carrying the item's name rather than a broken
 *  image. */
export type CatalogItem = {
  id: string
  name: string
  totalStock: number
  /** Optional photo URL. Falls back to a typographic tile when absent. */
  image?: string
  /** Lowercase phrases a customer might say for this item. */
  aliases: string[]
}

export const CATALOG: CatalogItem[] = [
  {
    id: 'camera_a',
    name: 'Camera A',
    totalStock: 2,
    image: '/camera-a.png',
    aliases: ['camera a', 'cam a', 'camera'],
  },
  {
    id: 'tripod_b',
    name: 'Tripod B',
    totalStock: 3,
    image: '/tripod-b.png',
    aliases: ['tripod b', 'tripod', 'stand', 'legs'],
  },
  {
    id: 'mic_c',
    name: 'Microphone C',
    totalStock: 1,
    image: '/microphone-c.png',
    aliases: ['microphone c', 'mic c', 'microphone', 'mic'],
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
    const needles = [item.id, item.name, ...item.aliases]
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
