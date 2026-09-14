// Decides what each conversational turn measured, from the sequence of events
// the voice service reports.
//
// Deliberately free of browser APIs. Three separate measurement bugs shipped
// while this logic lived inside the WebRTC client, and each was found only by
// reading recorded data after a manual conversation — because nothing could
// exercise it without a microphone. Extracted here it is replayable, so a wrong
// assumption about event ordering fails in the suite instead of in a session.

export type LatencySample = {
  turn: number
  /** Client learns the turn ended → server starts sending audio. */
  detectedToAudioMs: number
  /** Client learns the turn ended → first frame loud enough to hear. */
  detectedToAudibleMs: number | null
  /** The brief's measure: customer stops speaking → any audio begins. */
  turnEndToAudioMs: number
  /** The brief's measure, to the first genuinely audible frame. */
  turnEndToAudibleMs: number | null
  /**
   * Customer stops speaking → the audio carrying the actual answer.
   *
   * On a turn that needs a database lookup the agent says "let me check" first,
   * so `turnEndToAudioMs` becomes the time to that acknowledgement. Reporting
   * only that would be gaming the metric: the silence is gone, the answer is
   * not one millisecond earlier. This is the figure that did not improve.
   */
  turnEndToAnswerMs: number | null
  /** Database lookups this turn needed. Zero means answer == first audio. */
  toolCalls: number
  /** The silence window added back, recorded so the figures stay auditable. */
  vadSilenceMs: number
  /** False when the customer talked over the agent on or before this turn. */
  clean: boolean
}

type PendingTurn = {
  turn: number
  startedAt: number
  bargedIn: boolean
  assistantWasSpeaking: boolean
  audioAt: number | null
  audibleAt: number | null
  answerAt: number | null
  toolCalls: number
  awaitingAnswer: boolean
}

export class TurnTimer {
  private turn = 0
  private pending: PendingTurn | null = null
  private assistantSpeaking = false
  /**
   * Set when the customer talks over the agent, consumed by the next turn. It
   * cannot be read from `assistantSpeaking` there: handling the barge-in has
   * already cleared that, which is why the first version marked every
   * interrupting turn as clean.
   */
  private followsInterruption = false

  constructor(
    private readonly vadSilenceMs: number,
    private readonly emit: (sample: LatencySample) => void,
  ) {}

  /** The turn being timed. Recorded on barge-ins so the reviewer page can
   *  work out which turn interrupted which. */
  get currentTurn(): number {
    return this.turn
  }

  /** @returns true when this was a barge-in — the agent was mid-answer. */
  speechStarted(): boolean {
    if (!this.assistantSpeaking) return false

    this.assistantSpeaking = false
    this.followsInterruption = true
    if (this.pending) this.pending.bargedIn = true
    return true
  }

  speechStopped(at: number): void {
    // The turn in progress is closed here rather than on any response, because
    // no response reliably marks the end of a turn: the agent commonly speaks
    // its acknowledgement as one response and calls the tool in the next.
    this.flush()

    this.turn += 1
    this.pending = {
      turn: this.turn,
      startedAt: at,
      bargedIn: false,
      assistantWasSpeaking: this.followsInterruption || this.assistantSpeaking,
      audioAt: null,
      audibleAt: null,
      answerAt: null,
      toolCalls: 0,
      awaitingAnswer: false,
    }
    this.followsInterruption = false
  }

  audioStarted(at: number): void {
    this.assistantSpeaking = true
    const pending = this.pending
    if (!pending) return

    if (pending.audioAt === null) pending.audioAt = at
    if (pending.awaitingAnswer && pending.answerAt === null) pending.answerAt = at
  }

  audioStopped(): void {
    this.assistantSpeaking = false
  }

  responseDone(functionCalls: number): void {
    if (this.pending) this.pending.toolCalls += functionCalls
  }

  /** The tool result has been sent and a spoken reply asked for. */
  answerRequested(): void {
    if (this.pending) this.pending.awaitingAnswer = true
  }

  audible(at: number): void {
    const pending = this.pending
    if (!pending || pending.audibleAt !== null) return
    // Audio cannot be heard before it is sent. Without this the detector
    // catches the previous answer still playing out after a barge-in.
    if (pending.audioAt === null) return
    pending.audibleAt = at
  }

  /** Emits the turn in progress, if it produced any audio at all. */
  flush(): void {
    const pending = this.pending
    this.pending = null
    if (!pending || pending.audioAt === null) return

    const since = (at: number) => Math.round(at - pending.startedAt)
    const detectedToAudioMs = since(pending.audioAt)
    const detectedToAudibleMs = pending.audibleAt === null ? null : since(pending.audibleAt)

    this.emit({
      turn: pending.turn,
      detectedToAudioMs,
      detectedToAudibleMs,
      turnEndToAudioMs: detectedToAudioMs + this.vadSilenceMs,
      turnEndToAudibleMs:
        detectedToAudibleMs === null ? null : detectedToAudibleMs + this.vadSilenceMs,
      turnEndToAnswerMs:
        pending.toolCalls === 0
          ? detectedToAudioMs + this.vadSilenceMs
          : pending.answerAt === null
            ? null
            : since(pending.answerAt) + this.vadSilenceMs,
      toolCalls: pending.toolCalls,
      vadSilenceMs: this.vadSilenceMs,
      clean: !pending.bargedIn && !pending.assistantWasSpeaking,
    })
  }
}
