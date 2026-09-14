// The browser half of the voice session: microphone in, speech out, tool calls
// relayed to the server, and the timestamps that make the latency claim honest.
//
// Invariant: this file transports and measures. It never decides. Every tool
// call goes to /api/tools and the answer it reads aloud is whatever came back.

export type VoiceState = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking'

/**
 * Four figures, because one would hide where the time goes.
 *
 * Server VAD only reports the turn as ended once it has heard a full silence
 * window, so the event reaches us roughly `vadSilenceMs` AFTER the customer
 * actually stopped talking. The window therefore has to be added back to get
 * the figure the brief asks for — end of the customer's turn to first answer —
 * not subtracted from it.
 */
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
   * Customer stops speaking → the audio that carries the actual answer begins.
   *
   * On a turn that needs a database lookup, the agent now says something like
   * "let me check" first, so `turnEndToAudioMs` becomes the time to that
   * acknowledgement. Reporting only that number would be gaming the metric: the
   * silence is gone, but the answer is not one millisecond earlier. This is the
   * figure that did not improve, kept so both can be reported side by side.
   */
  turnEndToAnswerMs: number | null
  /** How many database lookups this turn needed. Zero means answer == audio. */
  toolCalls: number
  /** The silence window added back, recorded so the figures stay auditable. */
  vadSilenceMs: number
  /**
   * False when this turn interrupted the agent, or was itself interrupted.
   * The clock then no longer measures "how long did an answer take": the
   * response may have been already in flight, or cancelled part-way. Only
   * clean turns belong in a headline figure.
   */
  clean: boolean
}

type PendingTurn = {
  turn: number
  startedAt: number
  bargedIn: boolean
  assistantWasSpeaking: boolean
  rawMs: number | null
  audibleMs: number | null
  answerMs: number | null
  toolCalls: number
  awaitingAnswer: boolean
  finalizeTimer: ReturnType<typeof setTimeout> | null
}

export type TranscriptEntry = {
  role: 'user' | 'assistant'
  text: string
  at: number
}

export type VoiceCallbacks = {
  onState?: (state: VoiceState) => void
  onTranscript?: (entry: TranscriptEntry) => void
  onToolResult?: (result: { tool: string; status: string; facts: Record<string, unknown> }) => void
  onLatency?: (sample: LatencySample) => void
  onUsage?: (usage: Record<string, unknown>) => void
  onBargeIn?: () => void
  onError?: (message: string) => void
}

/** Above this RMS the assistant is audible rather than sending digital silence. */
const AUDIBLE_RMS_THRESHOLD = 0.01
/** Consecutive frames required, so one codec click does not count as speech. */
const AUDIBLE_CONFIRM_FRAMES = 2
/**
 * How long to keep listening for the first audible frame after the server says
 * it started sending. Without this the sample is emitted the moment the data
 * channel reports audio, which is always earlier than anything is hearable.
 */
const AUDIBLE_GRACE_MS = 900
/**
 * How long to keep a turn open waiting for the answer that follows a database
 * lookup, before giving up and reporting the turn without one.
 */
const ANSWER_TIMEOUT_MS = 8000

const SDP_URL = 'https://api.openai.com/v1/realtime/calls'

/**
 * Turns the provider's refusal into something a person can act on. A bare
 * status code sends you looking for a bug in code that is working fine — the
 * most common causes here are account-level, not ours.
 */
function describeRefusal(status: number, body: string): string {
  let providerMessage = ''
  let providerCode = ''
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string; code?: string } }
    providerMessage = parsed.error?.message ?? ''
    providerCode = parsed.error?.code ?? ''
  } catch {
    providerMessage = body.slice(0, 200)
  }

  if (status === 429) {
    const outOfCredit =
      providerCode === 'credit_balance_exhausted' || /credit|quota/i.test(providerMessage)
    return outOfCredit
      ? `The OpenAI account has no credit left, so the voice session could not start. Add credit at platform.openai.com/settings/organization/billing. (${providerMessage})`
      : `Too many voice sessions at once. Wait a moment and try again. (${providerMessage})`
  }

  if (status === 401 || status === 403) {
    return `The OpenAI key was rejected. Check OPENAI_API_KEY in .env. (${providerMessage})`
  }

  return providerMessage
    ? `The voice service refused the connection (${status}): ${providerMessage}`
    : `The voice service refused the connection (${status}).`
}

export class RealtimeVoiceClient {
  private readonly sessionId: string
  private readonly callbacks: VoiceCallbacks

  private connection: RTCPeerConnection | null = null
  private channel: RTCDataChannel | null = null
  private microphone: MediaStream | null = null
  private audioElement: HTMLAudioElement | null = null

  private audioContext: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private onsetFrame = 0
  private onsetTimer: number | null = null

  private vadSilenceMs = 0
  private turn = 0
  private pending: PendingTurn | null = null
  private assistantSpeaking = false
  /**
   * Set when the customer talks over the agent, and consumed by the next turn.
   * It cannot be read off `assistantSpeaking` at that point: handling the
   * barge-in has already cleared that flag, which is why the first version of
   * this marked every interrupting turn as clean.
   */
  private followsInterruption = false
  /**
   * The server allows one response at a time. Turn detection creates responses
   * on its own when the customer stops speaking, so a reply we ask for after a
   * tool result can collide with one the server already started — which the API
   * refuses outright. Asking is therefore queued rather than fired blindly.
   */
  private responseActive = false
  private responseQueued = false

  constructor(sessionId: string, callbacks: VoiceCallbacks = {}) {
    this.sessionId = sessionId
    this.callbacks = callbacks
  }

  async connect(): Promise<void> {
    this.setState('connecting')

    try {
      const session = await this.mintToken()
      this.vadSilenceMs = session.vadSilenceMs

      this.microphone = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      })

      const connection = new RTCPeerConnection()
      this.connection = connection

      this.audioElement = document.createElement('audio')
      this.audioElement.autoplay = true
      connection.ontrack = (event) => {
        if (this.audioElement) this.audioElement.srcObject = event.streams[0]
        this.watchForAudioOnset(event.streams[0])
      }

      connection.addTrack(this.microphone.getAudioTracks()[0], this.microphone)

      const channel = connection.createDataChannel('oai-events')
      this.channel = channel
      channel.addEventListener('message', (event) => {
        this.handleServerEvent(JSON.parse(event.data as string))
      })
      channel.addEventListener('open', () => this.setState('listening'))

      const offer = await connection.createOffer()
      await connection.setLocalDescription(offer)

      const answer = await fetch(SDP_URL, {
        method: 'POST',
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${session.clientSecret}`,
          'Content-Type': 'application/sdp',
        },
      })

      if (!answer.ok) {
        throw new Error(describeRefusal(answer.status, await answer.text().catch(() => '')))
      }

      await connection.setRemoteDescription({ type: 'answer', sdp: await answer.text() })
    } catch (error) {
      this.setState('idle')
      this.callbacks.onError?.(
        error instanceof Error ? error.message : 'Could not start the voice session.',
      )
      this.disconnect()
    }
  }

  disconnect(): void {
    if (this.onsetTimer !== null) cancelAnimationFrame(this.onsetTimer)
    this.onsetTimer = null

    this.channel?.close()
    this.connection?.close()
    this.microphone?.getTracks().forEach((track) => track.stop())
    void this.audioContext?.close()

    this.channel = null
    this.connection = null
    this.microphone = null
    this.analyser = null
    this.audioContext = null

    if (this.audioElement) {
      this.audioElement.srcObject = null
      this.audioElement = null
    }

    if (this.pending?.finalizeTimer) clearTimeout(this.pending.finalizeTimer)
    this.pending = null
    this.assistantSpeaking = false
    this.responseActive = false
    this.responseQueued = false
    this.setState('idle')
  }

  private async mintToken(): Promise<{ clientSecret: string; vadSilenceMs: number }> {
    const response = await fetch('/api/realtime/session', { method: 'POST' })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error ?? 'Could not start a voice session.')
    return data
  }

  private handleServerEvent(event: Record<string, unknown>): void {
    const type = String(event.type ?? '')

    switch (type) {
      case 'input_audio_buffer.speech_started':
        // The customer started talking. If we were mid-answer, that is a
        // barge-in: the server cancels its response, and we silence whatever is
        // already buffered on this side so nothing talks over them.
        if (this.assistantSpeaking) this.handleBargeIn()
        this.setState('listening')
        return

      case 'input_audio_buffer.speech_stopped':
        // The measurement starts here, on arrival rather than on the server's
        // own audio clock, because that is the moment this client could first
        // have known the turn ended.
        this.finalisePending()
        this.turn += 1
        this.pending = {
          turn: this.turn,
          startedAt: performance.now(),
          bargedIn: false,
          assistantWasSpeaking: this.followsInterruption || this.assistantSpeaking,
          rawMs: null,
          audibleMs: null,
          answerMs: null,
          toolCalls: 0,
          awaitingAnswer: false,
          finalizeTimer: null,
        }
        this.followsInterruption = false
        this.onsetFrame = 0
        this.setState('thinking')
        return

      case 'output_audio_buffer.started':
        this.assistantSpeaking = true
        if (this.audioElement) this.audioElement.muted = false
        this.setState('speaking')
        this.markFirstAudio(performance.now())
        return

      case 'output_audio_buffer.stopped':
      case 'output_audio_buffer.cleared':
        this.assistantSpeaking = false
        this.setState('listening')
        return

      case 'response.created':
        this.responseActive = true
        return

      case 'response.done':
        this.responseActive = false
        void this.handleResponseDone(event).then(() => this.flushQueuedResponse())
        return

      case 'error': {
        const message = (event.error as { message?: string } | undefined)?.message ?? ''
        // Expected when a reply is asked for while one is already running. It
        // is already queued, so surfacing it would be noise, not information.
        if (message.includes('active response')) return
        this.callbacks.onError?.(message || 'The voice service reported an error.')
        return
      }
    }

    // Transcript events have been renamed more than once across API versions.
    // Matching on shape rather than an exact name keeps the on-screen
    // transcript working without pinning it to today's spelling.
    if (typeof event.transcript === 'string' && type.endsWith('.done')) {
      const role = type.includes('input_audio_transcription') ? 'user' : 'assistant'
      this.callbacks.onTranscript?.({ role, text: event.transcript, at: Date.now() })
    } else if (typeof event.transcript === 'string' && type.endsWith('.completed')) {
      this.callbacks.onTranscript?.({ role: 'user', text: event.transcript, at: Date.now() })
    }
  }

  private handleBargeIn(): void {
    // The server cancels its own response, but audio already in the jitter
    // buffer would still play out. Muting stops it in the same tick.
    if (this.audioElement) this.audioElement.muted = true
    this.assistantSpeaking = false
    this.followsInterruption = true
    // Any reply still waiting to be spoken answers the request the customer
    // just changed. Speaking it now would be answering a superseded question;
    // their new turn will produce its own reply.
    this.responseQueued = false
    if (this.pending) this.pending.bargedIn = true
    this.callbacks.onBargeIn?.()
    void this.record('barge_in', { at: Date.now(), turn: this.turn })
  }

  private async handleResponseDone(event: Record<string, unknown>): Promise<void> {
    const response = event.response as
      | { output?: Array<Record<string, unknown>>; usage?: Record<string, unknown> }
      | undefined

    if (response?.usage) {
      // Cost is computed from what the provider actually billed, not from an
      // estimate of how long someone spoke.
      this.callbacks.onUsage?.(response.usage)
      void this.record('usage', response.usage)
    }

    const calls = (response?.output ?? []).filter((item) => item.type === 'function_call')

    if (calls.length === 0) {
      // This response carried the spoken reply, so the turn is over. A short
      // grace lets the audible-onset check land before the sample is closed.
      const pending = this.pending
      if (pending && pending.finalizeTimer === null) {
        pending.finalizeTimer = setTimeout(() => this.finalisePending(), AUDIBLE_GRACE_MS)
      }
      return
    }

    if (this.pending) this.pending.toolCalls += calls.length

    for (const call of calls) {
      const name = String(call.name ?? '')
      const callId = String(call.call_id ?? '')
      let args: unknown = {}
      try {
        args = JSON.parse(String(call.arguments ?? '{}'))
      } catch {
        args = {}
      }

      const result = await this.runTool(name, args)
      this.callbacks.onToolResult?.(result)

      this.send({
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify(result),
        },
      })
    }

    // The tool results are in the conversation; ask for the spoken reply. From
    // here the next audio is the answer itself, not the acknowledgement.
    if (this.pending) {
      this.pending.awaitingAnswer = true
      if (this.pending.finalizeTimer !== null) clearTimeout(this.pending.finalizeTimer)
      this.pending.finalizeTimer = setTimeout(
        () => this.finalisePending(),
        ANSWER_TIMEOUT_MS,
      )
    }
    this.requestResponse()
  }

  /** Asks for a spoken reply, waiting if the server is already producing one. */
  private requestResponse(): void {
    if (this.responseActive) {
      this.responseQueued = true
      return
    }
    this.responseQueued = false
    this.send({ type: 'response.create' })
  }

  private flushQueuedResponse(): void {
    if (this.responseQueued && !this.responseActive) {
      this.responseQueued = false
      this.send({ type: 'response.create' })
    }
  }

  private async runTool(
    tool: string,
    args: unknown,
  ): Promise<{ tool: string; status: string; facts: Record<string, unknown>; guidance?: string }> {
    try {
      const response = await fetch('/api/tools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: this.sessionId, tool, args }),
      })
      return await response.json()
    } catch {
      return {
        tool,
        status: 'unavailable',
        facts: {},
        guidance:
          'The booking system could not be reached, so nothing was saved. Apologise and ask the customer to try again in a moment.',
      }
    }
  }

  /**
   * Audio started for this turn. The sample is held open rather than closed
   * here: the audible check resolves later by definition, and on a turn with a
   * database lookup the first audio is only the acknowledgement — the answer
   * itself is still to come.
   */
  private markFirstAudio(at: number): void {
    const pending = this.pending
    if (!pending) return

    if (pending.rawMs === null) {
      pending.rawMs = Math.round(at - pending.startedAt)
    }

    if (pending.awaitingAnswer && pending.answerMs === null) {
      pending.answerMs = Math.round(at - pending.startedAt)
    }

    // Deliberately no timer here. Closing the sample on a timer after the first
    // audio was the original bug: on a turn with a lookup the acknowledgement
    // takes about a second to speak, so response.done — which is what reveals
    // that a lookup happened at all — always arrived too late to be counted.
    // The sample is now closed by response.done instead, which always comes.
  }

  private finalisePending(): void {
    const pending = this.pending
    if (!pending) return

    if (pending.finalizeTimer !== null) clearTimeout(pending.finalizeTimer)
    this.pending = null

    // No audio ever came back for that turn — there is nothing to time.
    if (pending.rawMs === null) return

    const sample: LatencySample = {
      turn: pending.turn,
      detectedToAudioMs: pending.rawMs,
      detectedToAudibleMs: pending.audibleMs,
      turnEndToAudioMs: pending.rawMs + this.vadSilenceMs,
      turnEndToAudibleMs:
        pending.audibleMs === null ? null : pending.audibleMs + this.vadSilenceMs,
      // With no lookup there is no acknowledgement, so the first audio already
      // is the answer.
      turnEndToAnswerMs:
        pending.toolCalls === 0
          ? pending.rawMs + this.vadSilenceMs
          : pending.answerMs === null
            ? null
            : pending.answerMs + this.vadSilenceMs,
      toolCalls: pending.toolCalls,
      vadSilenceMs: this.vadSilenceMs,
      clean: !pending.bargedIn && !pending.assistantWasSpeaking,
    }

    this.callbacks.onLatency?.(sample)
    void this.record('latency', sample)
  }

  /**
   * Independent check on the data-channel timestamp: watches the incoming audio
   * track and notes the first frame that is actually loud enough to hear, plus
   * the output device's own delay. It answers "when did the customer hear
   * something", which is a later moment than "when did the server start sending".
   */
  private watchForAudioOnset(stream: MediaStream): void {
    const context = new AudioContext()
    this.audioContext = context

    const source = context.createMediaStreamSource(stream)
    const analyser = context.createAnalyser()
    analyser.fftSize = 2048
    source.connect(analyser)
    this.analyser = analyser

    const samples = new Float32Array(analyser.fftSize)

    const tick = () => {
      this.onsetTimer = requestAnimationFrame(tick)

      const pending = this.pending
      if (!pending || pending.audibleMs !== null || !this.analyser) return

      // Not before the server says it has started sending. The detector runs
      // continuously, so without this it catches the tail of the previous
      // answer still playing out after a barge-in and reports a turn as audible
      // before any of its audio existed — which produced impossible figures
      // lower than the data-channel timestamp.
      if (pending.rawMs === null) return

      this.analyser.getFloatTimeDomainData(samples)
      let sumOfSquares = 0
      for (const value of samples) sumOfSquares += value * value
      const rms = Math.sqrt(sumOfSquares / samples.length)

      if (rms < AUDIBLE_RMS_THRESHOLD) {
        this.onsetFrame = 0
        return
      }

      this.onsetFrame += 1
      if (this.onsetFrame < AUDIBLE_CONFIRM_FRAMES) return

      // The device's own output delay sits between a frame reaching the graph
      // and a person hearing it, so it belongs in the figure.
      const outputLatencyMs = (context.outputLatency || 0) * 1000
      pending.audibleMs = Math.round(
        performance.now() + outputLatencyMs - pending.startedAt,
      )

      // The later of the two measurements has landed; no reason to keep waiting.
      if (pending.rawMs !== null) this.finalisePending()
    }

    this.onsetTimer = requestAnimationFrame(tick)
  }

  private send(event: Record<string, unknown>): void {
    if (this.channel?.readyState === 'open') {
      this.channel.send(JSON.stringify(event))
    }
  }

  private async record(type: string, payload: unknown): Promise<void> {
    try {
      await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: this.sessionId, type, payload }),
      })
    } catch {
      // Evidence logging must never break the conversation.
    }
  }

  private setState(state: VoiceState): void {
    this.callbacks.onState?.(state)
  }
}
