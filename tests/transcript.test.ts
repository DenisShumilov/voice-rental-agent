// Replays the arrival orders that broke the on-screen transcript.
//
// The customer's words and the agent's reply come back on two independent
// pipelines, and transcription is the slower of them. Appending each entry as
// it arrived put the answer above the question on any turn where transcription
// lagged — which is most turns of any length.

import { describe, expect, it } from 'vitest'

import { mergeTranscript } from '@/voice/transcript'
import type { TranscriptEntry } from '@/voice/realtime-client'

const reserved = (id: string): TranscriptEntry => ({ id, role: 'user', text: '', at: 0 })
const heard = (id: string, text: string): TranscriptEntry => ({ id, role: 'user', text, at: 1 })
const spoke = (id: string, text: string): TranscriptEntry => ({
  id,
  role: 'assistant',
  text,
  at: 2,
})

function replay(events: TranscriptEntry[]): TranscriptEntry[] {
  return events.reduce<TranscriptEntry[]>((entries, entry) => mergeTranscript(entries, entry), [])
}

describe('mergeTranscript', () => {
  it('keeps the question above the answer when transcription arrives last', () => {
    const entries = replay([
      reserved('user-1'),
      spoke('agent-1', 'Let me check that.'),
      heard('user-1', 'I need a camera on the fifteenth.'),
    ])

    expect(entries.map((entry) => entry.text)).toEqual([
      'I need a camera on the fifteenth.',
      'Let me check that.',
    ])
  })

  it('keeps the order when transcription arrives first', () => {
    const entries = replay([
      reserved('user-1'),
      heard('user-1', 'I need a camera.'),
      spoke('agent-1', 'For which days?'),
    ])

    expect(entries.map((entry) => entry.role)).toEqual(['user', 'assistant'])
  })

  it('interleaves several turns correctly however late each transcription is', () => {
    const entries = replay([
      reserved('user-1'),
      spoke('agent-1', 'Which days?'),
      heard('user-1', 'A camera please.'),
      reserved('user-2'),
      spoke('agent-2', 'That works.'),
      heard('user-2', 'The fifteenth to the seventeenth.'),
    ])

    expect(entries.map((entry) => entry.text)).toEqual([
      'A camera please.',
      'Which days?',
      'The fifteenth to the seventeenth.',
      'That works.',
    ])
  })

  it('drops a reserved slot that never received its words when the next turn starts', () => {
    const entries = replay([reserved('user-1'), reserved('user-2'), heard('user-2', 'Hello.')])

    expect(entries).toHaveLength(1)
    expect(entries[0].text).toBe('Hello.')
  })

  it('keeps the waiting slot while the agent is still replying to it', () => {
    const entries = replay([reserved('user-1'), spoke('agent-1', 'One moment.')])

    expect(entries).toHaveLength(2)
    expect(entries[0].text).toBe('')
  })

  it('accepts a transcription with no reserved slot rather than dropping it', () => {
    const entries = replay([heard('user-9', 'Straight through.')])

    expect(entries.map((entry) => entry.text)).toEqual(['Straight through.'])
  })

  it('keeps the list bounded', () => {
    const many = Array.from({ length: 60 }, (_, index) => spoke(`agent-${index}`, `line ${index}`))
    const entries = replay(many)

    expect(entries).toHaveLength(40)
    expect(entries.at(-1)?.text).toBe('line 59')
  })
})
