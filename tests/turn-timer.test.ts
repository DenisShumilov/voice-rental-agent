// Replays the event sequences a real conversation produces, so the latency
// figures can be verified without a microphone.
//
// Every test below corresponds to a measurement bug that actually shipped and
// was only caught by reading recorded data afterwards. Each one fails against
// the version of the code that had that bug.

import { beforeEach, describe, expect, it } from 'vitest'

import { TurnTimer, type LatencySample } from '@/voice/turn-timer'

const VAD_SILENCE_MS = 500

let samples: LatencySample[]
let timer: TurnTimer

beforeEach(() => {
  samples = []
  timer = new TurnTimer(VAD_SILENCE_MS, (sample) => samples.push(sample))
})

describe('TurnTimer', () => {
  it('adds the silence window back rather than subtracting it', () => {
    // Server VAD reports the turn ended only after hearing the full window, so
    // the event arrives about that much AFTER the customer stopped. Subtracting
    // it produced impossible negative figures and flattered the report.
    timer.speechStopped(0)
    timer.audioStarted(300)
    timer.flush()

    expect(samples[0].turnEndToAudioMs).toBe(800)
    expect(samples[0].detectedToAudioMs).toBe(300)
  })

  it('times a turn with no database lookup', () => {
    timer.speechStopped(1000)
    timer.audioStarted(1600)
    timer.audible(1750)
    timer.responseDone(0)
    timer.flush()

    expect(samples).toHaveLength(1)
    expect(samples[0]).toMatchObject({
      turnEndToAudioMs: 1100,
      turnEndToAudibleMs: 1250,
      turnEndToAnswerMs: 1100,
      toolCalls: 0,
      clean: true,
    })
  })

  // The bug that shipped twice: the agent speaks its acknowledgement as a
  // response of its own, and the tool call arrives in the NEXT response.
  // Treating any call-free response as the end of the turn recorded turns that
  // queried the database as needing no lookup at all.
  it('keeps the turn open when the acknowledgement is its own response', () => {
    timer.speechStopped(0)
    timer.audioStarted(900) // "let me check"
    timer.responseDone(0) // acknowledgement finished — not the end of the turn
    timer.responseDone(1) // the function call
    timer.answerRequested()
    timer.audioStarted(3000) // the answer itself
    timer.responseDone(0)
    timer.flush()

    expect(samples).toHaveLength(1)
    expect(samples[0].toolCalls).toBe(1)
    expect(samples[0].turnEndToAudioMs).toBe(1400)
    expect(samples[0].turnEndToAnswerMs).toBe(3500)
  })

  it('times a lookup whose acknowledgement shares a response with the call', () => {
    timer.speechStopped(0)
    timer.audioStarted(800)
    timer.responseDone(1)
    timer.answerRequested()
    timer.audioStarted(2600)
    timer.flush()

    expect(samples[0].toolCalls).toBe(1)
    expect(samples[0].turnEndToAudioMs).toBe(1300)
    expect(samples[0].turnEndToAnswerMs).toBe(3100)
  })

  it('reports no answer when a lookup never produced one', () => {
    timer.speechStopped(0)
    timer.audioStarted(800)
    timer.responseDone(1)
    timer.answerRequested()
    timer.flush()

    expect(samples[0].toolCalls).toBe(1)
    expect(samples[0].turnEndToAnswerMs).toBeNull()
  })

  // The flag read a state that handling the barge-in had already cleared, so
  // every interrupting turn was recorded as clean — in one session, all of them.
  it('marks both the interrupted turn and the interrupting one as not clean', () => {
    timer.speechStopped(0)
    timer.audioStarted(800)

    expect(timer.speechStarted()).toBe(true)

    timer.speechStopped(2000) // closes the interrupted turn, opens the next
    timer.audioStarted(2900)
    timer.flush()

    expect(samples).toHaveLength(2)
    expect(samples[0].clean).toBe(false) // was talked over
    expect(samples[1].clean).toBe(false) // did the talking over
  })

  it('does not treat speech as a barge-in when the agent is silent', () => {
    timer.speechStopped(0)
    timer.audioStarted(800)
    timer.audioStopped()

    expect(timer.speechStarted()).toBe(false)

    timer.speechStopped(2000)
    timer.audioStarted(2600)
    timer.flush()

    expect(samples[1].clean).toBe(true)
  })

  // The onset detector runs continuously. Without this guard it caught the
  // previous answer still playing out and reported a turn as heard before any
  // of its audio had been sent.
  it('ignores an audible reading that arrives before the audio did', () => {
    timer.speechStopped(0)
    timer.audible(200) // the previous answer, still playing
    timer.audioStarted(800)
    timer.audible(950)
    timer.flush()

    expect(samples[0].turnEndToAudibleMs).toBe(1450)
  })

  it('produces nothing for a turn that never got audio', () => {
    timer.speechStopped(0)
    timer.responseDone(0)
    timer.flush()

    expect(samples).toHaveLength(0)
  })

  it('closes each turn when the next one starts', () => {
    timer.speechStopped(0)
    timer.audioStarted(700)
    timer.speechStopped(5000)
    timer.audioStarted(5900)
    timer.speechStopped(9000)

    expect(samples.map((sample) => sample.turnEndToAudioMs)).toEqual([1200, 1400])
    expect(samples.map((sample) => sample.turn)).toEqual([1, 2])
  })

  it('emits nothing twice, however often it is flushed', () => {
    timer.speechStopped(0)
    timer.audioStarted(700)
    timer.flush()
    timer.flush()

    expect(samples).toHaveLength(1)
  })
})
