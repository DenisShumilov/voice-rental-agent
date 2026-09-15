// The browser half of the voice session: microphone in, speech out, tool calls
// relayed to the server.
//
// Invariant: this file transports. It never decides — every tool call goes to
// /api/tools and the answer it reads aloud is whatever came back — and it does
// not work out what a turn measured either. That lives in TurnTimer, which is
// free of browser APIs and therefore testable without a microphone.

import { TurnTimer, type LatencySample } from './turn-timer'

export type { LatencySample }

export type VoiceState = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking'

export type TranscriptEntry = {
  /**
   * Stable across the two events that make up one customer turn. The slot is
   * reserved the moment they stop speaking and filled when the transcription
   * arrives — which is a separate, slower pipeline than the agent's reply, so
   * appending on arrival put the answer above the question that prompted it.
   */
  id: string
  role: 'user' | 'assistant'
  text: string
  at: number
}

/** Loudness right now, 0 to roughly 1, from the two live audio streams. */
export type AudioLevels = {
  input: number
  output: number
}

export type VoiceCallbacks = {
  onState?: (state: VoiceState) => void
  onLevel?: (levels: AudioLevels) => void
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
/** Closes the last turn of a conversation, which no following turn will close. */
const TURN_BACKSTOP_MS = 20000

const SDP_URL = 'https://api.openai.com/v1/realtime/calls'

function rootMeanSquare(samples: Float32Array): number {
  let sumOfSquares = 0
  for (const value of samples) sumOfSquares += value * value
  return Math.sqrt(sumOfSquares / samples.length)
}

/** Rises quickly, falls slowly — a meter that twitches reads as broken. */
function smooth(previous: number, next: number): number {
  return next > previous ? previous + (next - previous) * 0.5 : previous * 0.82
}

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
      : `The voice service refused the connection: rate limited (429). Wait a moment and try again. (${providerMessage})`
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
  private inputAnalyser: AnalyserNode | null = null
  private onsetFrame = 0
  private onsetTimer: number | null = null
  private smoothedInput = 0
  private smoothedOutput = 0

  private timer: TurnTimer | null = null
  private backstop: ReturnType<typeof setTimeout> | null = null

  /**
   * The server allows one response at a time and creates them on its own when
   * turn detection fires, so a reply asked for after a tool result can collide
   * with one already running — which the API refuses. Asking is queued.
   */
  private responseActive = false
  /** Counts turns heard and turns spoken, so every transcript entry has an id. */
  private turnsHeard = 0
  private agentTurns = 0
  private pendingUserTurn: string | null = null
  private responseQueued = false

  constructor(sessionId: string, callbacks: VoiceCallbacks = {}) {
    this.sessionId = sessionId
    this.callbacks = callbacks
  }

  async connect(): Promise<void> {
    this.setState('connecting')

    try {
      const session = await this.mintToken()

      this.timer = new TurnTimer(session.vadSilenceMs, (sample) => {
        this.callbacks.onLatency?.(sample)
        void this.record('latency', sample)
      })

      try {
        this.microphone = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
        })
      } catch {
        // The browser's own message here is a bare error name, and it covers
        // three different causes — permission denied, no device, device held by
        // another app. Name the remedy rather than guessing the cause.
        throw new Error(
          'Could not open the microphone. Check that this page is allowed to use it and that no other app is holding it, then press Start talking again.',
        )
      }

      const connection = new RTCPeerConnection()
      this.connection = connection

      this.audioElement = document.createElement('audio')
      this.audioElement.autoplay = true
      connection.ontrack = (event) => {
        if (this.audioElement) this.audioElement.srcObject = event.streams[0]
        this.watchForAudioOnset(event.streams[0])
      }

      connection.addTrack(this.microphone.getAudioTracks()[0], this.microphone)
      this.watchMicrophoneLevel(this.microphone)

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
    // Report the turn in progress before tearing anything down, otherwise the
    // last exchange of every conversation is silently lost.
    this.timer?.flush()

    if (this.onsetTimer !== null) cancelAnimationFrame(this.onsetTimer)
    if (this.backstop !== null) clearTimeout(this.backstop)
    this.onsetTimer = null
    this.backstop = null

    this.channel?.close()
    this.connection?.close()
    this.microphone?.getTracks().forEach((track) => track.stop())
    void this.audioContext?.close()

    this.channel = null
    this.connection = null
    this.microphone = null
    this.analyser = null
    this.inputAnalyser = null
    this.audioContext = null
    this.timer = null
    this.smoothedInput = 0
    this.smoothedOutput = 0
    this.callbacks.onLevel?.({ input: 0, output: 0 })

    if (this.audioElement) {
      this.audioElement.srcObject = null
      this.audioElement = null
    }

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
        if (this.timer?.speechStarted()) this.handleBargeIn()
        this.setState('listening')
        return

      case 'input_audio_buffer.speech_stopped':
        // Timed from arrival rather than the server's own audio clock: this is
        // the moment this client could first have known the turn ended.
        this.timer?.speechStopped(performance.now())
        this.onsetFrame = 0
        this.armBackstop()
        this.setState('thinking')
        // Reserve the customer's place in the transcript now, while the order
        // is still certain. An empty entry renders as "…", which also answers
        // "did it hear me?" before the words come back.
        this.pendingUserTurn = `user-${(this.turnsHeard += 1)}`
        this.callbacks.onTranscript?.({
          id: this.pendingUserTurn,
          role: 'user',
          text: '',
          at: Date.now(),
        })
        return

      case 'output_audio_buffer.started':
        if (this.audioElement) this.audioElement.muted = false
        this.timer?.audioStarted(performance.now())
        this.setState('speaking')
        return

      case 'output_audio_buffer.stopped':
      case 'output_audio_buffer.cleared':
        this.timer?.audioStopped()
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
    if (typeof event.transcript !== 'string') return
    if (!type.endsWith('.done') && !type.endsWith('.completed')) return

    const role =
      type.endsWith('.completed') || type.includes('input_audio_transcription')
        ? 'user'
        : 'assistant'

    this.callbacks.onTranscript?.({
      id: role === 'user' ? this.takePendingUserTurn() : `agent-${(this.agentTurns += 1)}`,
      role,
      text: event.transcript,
      at: Date.now(),
    })
  }

  /**
   * The slot reserved when the customer stopped speaking, if it is still
   * waiting. A transcription with no reserved slot — the API renaming these
   * events has happened more than once — still gets an id of its own rather
   * than being dropped.
   */
  private takePendingUserTurn(): string {
    const reserved = this.pendingUserTurn
    this.pendingUserTurn = null
    return reserved ?? `user-${(this.turnsHeard += 1)}`
  }

  private handleBargeIn(): void {
    // The server cancels its own response, but audio already in the jitter
    // buffer would still play out. Muting stops it in the same tick.
    if (this.audioElement) this.audioElement.muted = true
    // Any reply still waiting answers the request the customer just changed.
    this.responseQueued = false
    this.callbacks.onBargeIn?.()
    void this.record('barge_in', { at: Date.now(), turn: this.timer?.currentTurn ?? 0 })
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
    this.timer?.responseDone(calls.length)
    if (calls.length === 0) return

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

    // From here the next audio is the answer itself, not the acknowledgement.
    this.timer?.answerRequested()
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
          'The booking system could not be reached. You do not know whether anything was saved, so do not say either way. Apologise, and ask the customer to try again in a moment.',
      }
    }
  }

  /** A turn normally closes when the next begins; this closes the last one. */
  private armBackstop(): void {
    if (this.backstop !== null) clearTimeout(this.backstop)
    this.backstop = setTimeout(() => this.timer?.flush(), TURN_BACKSTOP_MS)
  }

  /**
   * Independent check on the data-channel timestamp: watches the incoming audio
   * track and notes the first frame actually loud enough to hear, plus the
   * output device's own delay. It answers "when did the customer hear
   * something", a later moment than "when did the server start sending".
   */
  private context(): AudioContext {
    if (!this.audioContext) this.audioContext = new AudioContext()
    return this.audioContext
  }

  /** Feeds the on-screen meter while the customer is talking. */
  private watchMicrophoneLevel(stream: MediaStream): void {
    const analyser = this.context().createAnalyser()
    analyser.fftSize = 1024
    this.context().createMediaStreamSource(stream).connect(analyser)
    this.inputAnalyser = analyser
  }

  private watchForAudioOnset(stream: MediaStream): void {
    const context = this.context()

    const source = context.createMediaStreamSource(stream)
    const analyser = context.createAnalyser()
    analyser.fftSize = 2048
    source.connect(analyser)
    this.analyser = analyser

    const outputSamples = new Float32Array(analyser.fftSize)
    const inputSamples = new Float32Array(1024)

    const tick = () => {
      this.onsetTimer = requestAnimationFrame(tick)
      if (!this.analyser) return

      this.analyser.getFloatTimeDomainData(outputSamples)
      const outputRms = rootMeanSquare(outputSamples)

      if (this.inputAnalyser) {
        this.inputAnalyser.getFloatTimeDomainData(inputSamples)
        this.smoothedInput = smooth(this.smoothedInput, rootMeanSquare(inputSamples))
      }
      this.smoothedOutput = smooth(this.smoothedOutput, outputRms)
      this.callbacks.onLevel?.({ input: this.smoothedInput, output: this.smoothedOutput })

      if (!this.timer) return

      if (outputRms < AUDIBLE_RMS_THRESHOLD) {
        this.onsetFrame = 0
        return
      }

      this.onsetFrame += 1
      if (this.onsetFrame < AUDIBLE_CONFIRM_FRAMES) return

      // The device's own output delay sits between a frame reaching the graph
      // and a person hearing it, so it belongs in the figure. TurnTimer ignores
      // readings that arrive before the audio did, and repeats within a turn.
      const outputLatencyMs = (context.outputLatency || 0) * 1000
      this.timer.audible(performance.now() + outputLatencyMs)
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
