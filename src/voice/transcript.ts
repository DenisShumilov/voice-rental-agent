// Merges transcript entries into the list the panel renders.
// Invariant: a customer's turn keeps the place it had when they stopped
// speaking, whenever its words arrive.
//
// Pure, and free of React and browser APIs, because the bug it fixes is a race
// between two pipelines and the only honest way to prove it is fixed is to
// replay the arrival order that broke it.

import type { TranscriptEntry } from './realtime-client'

/** Beyond this the panel scrolls forever and the oldest turns stop mattering. */
const KEEP = 40

export function mergeTranscript(
  entries: TranscriptEntry[],
  entry: TranscriptEntry,
): TranscriptEntry[] {
  const reserved = entries.findIndex((existing) => existing.id === entry.id)
  if (reserved >= 0) {
    const next = [...entries]
    next[reserved] = entry
    return next
  }

  // A reserved slot whose transcription never arrived would sit there forever;
  // the newest one is the only one still expecting words, so older empty ones
  // are dropped as a new turn begins.
  const startingNewTurn = entry.role === 'user' && entry.text.length === 0
  const kept = startingNewTurn
    ? entries.filter((existing) => !(existing.role === 'user' && existing.text.length === 0))
    : entries

  return [...kept, entry].slice(-KEEP)
}
