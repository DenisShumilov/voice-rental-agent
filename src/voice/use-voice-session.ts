'use client'

// React state for one conversation. Holds what the screen shows; the client
// object holds the connection. The request card and the booking card are built
// from tool results, so the screen can only ever show what the backend returned.

import { useCallback, useEffect, useRef, useState } from 'react'

import {
  RealtimeVoiceClient,
  type LatencySample,
  type TranscriptEntry,
  type VoiceState,
} from './realtime-client'

export type RequestCard = {
  item: string | null
  quantity: number | null
  startDate: string | null
  endDate: string | null
  available: number | null
  totalStock: number | null
  status: 'available' | 'unavailable' | 'needs_clarification'
}

export type BookingCard = {
  reference: string
  item: string
  quantity: number
  startDate: string
  endDate: string
  remaining: number | null
}

export function useVoiceSession() {
  const [sessionId] = useState(() => crypto.randomUUID())
  const [state, setState] = useState<VoiceState>('idle')
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([])
  const [latency, setLatency] = useState<LatencySample[]>([])
  const [request, setRequest] = useState<RequestCard | null>(null)
  const [booking, setBooking] = useState<BookingCard | null>(null)
  const [interruptions, setInterruptions] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const clientRef = useRef<RealtimeVoiceClient | null>(null)

  const start = useCallback(async () => {
    if (clientRef.current) return
    setError(null)

    const client = new RealtimeVoiceClient(sessionId, {
      onState: setState,
      onError: setError,
      onBargeIn: () => setInterruptions((count) => count + 1),
      onLatency: (sample) => setLatency((samples) => [...samples, sample]),
      onTranscript: (entry) =>
        setTranscript((entries) => [...entries, entry].slice(-40)),
      onToolResult: (result) => {
        const facts = result.facts ?? {}

        if (result.tool === 'set_request') {
          setRequest({
            item: asText(facts.item),
            quantity: asNumber(facts.quantity),
            startDate: asText(facts.start_date),
            endDate: asText(facts.end_date),
            available: asNumber(facts.available),
            totalStock: asNumber(facts.total_stock),
            status: result.status as RequestCard['status'],
          })
        }

        if (result.tool === 'confirm_booking' && facts.booking_reference) {
          setBooking({
            reference: String(facts.booking_reference),
            item: String(facts.item),
            quantity: Number(facts.quantity),
            startDate: String(facts.start_date),
            endDate: String(facts.end_date),
            remaining: asNumber(facts.remaining_for_those_dates),
          })
          setRequest(null)
        }
      },
    })

    clientRef.current = client
    await client.connect()
  }, [sessionId])

  const stop = useCallback(() => {
    clientRef.current?.disconnect()
    clientRef.current = null
    setState('idle')
  }, [])

  useEffect(() => {
    return () => {
      clientRef.current?.disconnect()
      clientRef.current = null
    }
  }, [])

  return {
    sessionId,
    state,
    transcript,
    latency,
    request,
    booking,
    interruptions,
    error,
    start,
    stop,
    isLive: state !== 'idle',
  }
}

function asText(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null
}
