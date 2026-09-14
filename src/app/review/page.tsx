'use client'

// The reviewer's page. Not part of the customer experience.
//
// Everything here is produced by running the real system: the checks drive the
// same tool layer the voice agent uses, the database rows are the actual rows,
// and the latency and cost figures come from recorded sessions. Nothing on this
// page is illustrative.

import { useCallback, useEffect, useState } from 'react'

type Check = { label: string; expected: unknown; actual: unknown; passed: boolean }
type Step = { spoken: string | null; tool: string; status: string }
type Snapshot = {
  total: number
  reservations: Array<{
    itemId: string
    quantity: number
    startDate: string
    endDate: string
    source: string
  }>
}
type ScenarioResult = {
  id: string
  title: string
  requirements: string[]
  given: string
  steps: Step[]
  checks: Check[]
  passed: boolean
  before: Snapshot
  after: Snapshot
}
type RunResponse = { ranAt: string; passed: boolean; results: ScenarioResult[] }

type Stats = { count: number; min: number; median: number; p95: number; max: number }
type Summary = {
  agent: Record<string, unknown>
  database: {
    items: Array<{ sku: string; name: string; totalStock: number }>
    seeded: Array<{ itemId: string; quantity: number; startDate: string; endDate: string }>
    reservations: Snapshot['reservations']
  }
  sessions: Array<{ id: string; startedAt: string; minutes: number; counts: Record<string, number> }>
  latency: {
    definition: Record<string, unknown>
    supersededSamples: number
    totalTurns: number
    uninterruptedTurns: number
    allTurns: { turnEndToAudio: Stats | null; turnEndToAudible: Stats | null }
    uninterrupted: { turnEndToAudio: Stats | null; turnEndToAudible: Stats | null }
    samples: Array<Record<string, unknown>>
  }
  cost: {
    breakdown: Record<string, number> | null
    voiceMinutes: number
    pricing: Record<string, never>
    hosting: {
      current: Array<{ item: string; usdPerMonth: number; note: string }>
      ifRunCommercially: Array<{ item: string; usdPerMonth: number; note: string }>
    }
  }
  events: Array<{ sessionId: string; ts: string; type: string; payload: unknown }>
}

export default function ReviewPage() {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [run, setRun] = useState<RunResponse | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadSummary = useCallback(async () => {
    try {
      const response = await fetch('/api/review', { cache: 'no-store' })
      setSummary(await response.json())
    } catch {
      setError('Could not load the recorded evidence.')
    }
  }, [])

  useEffect(() => {
    void loadSummary()
  }, [loadSummary])

  const runChecks = async () => {
    setRunning(true)
    setError(null)
    try {
      const response = await fetch('/api/review/run-tests', { method: 'POST' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? 'The run failed.')
      setRun(data)
      await loadSummary()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The run failed.')
    } finally {
      setRunning(false)
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-5 py-10 lg:px-8">
      <header className="border-b border-border pb-5">
        <div className="flex items-baseline justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">Reviewer view</h1>
          <a href="/" className="text-sm text-text-muted underline-offset-4 hover:underline">
            Back to the storefront
          </a>
        </div>
        <p className="mt-2 max-w-2xl text-sm text-text-muted">
          Evidence, not a dashboard. The checks below drive the same tool layer the voice agent
          uses; the latency and cost figures come from recorded conversations. Nothing here is
          illustrative.
        </p>
      </header>

      {error && (
        <p className="mt-5 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-warn">
          {error}
        </p>
      )}

      <Section title="Required checks">
        <div className="mb-4 flex items-center gap-3">
          <button
            type="button"
            onClick={runChecks}
            disabled={running}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition hover:opacity-90 disabled:opacity-50"
          >
            {running ? 'Running…' : 'Run all checks'}
          </button>
          {run && (
            <span className={`text-sm ${run.passed ? 'text-ok' : 'text-warn'}`}>
              {run.passed ? 'All checks passed' : 'Some checks failed'} ·{' '}
              <span className="font-mono text-xs text-text-muted">{run.ranAt}</span>
            </span>
          )}
        </div>

        {!run && (
          <p className="text-sm text-text-muted">
            The checks run against a scratch database, so they never disturb the bookings below.
            Expected results are declared in <Mono>src/lib/scenarios.ts</Mono> and are the same
            ones the test suite asserts.
          </p>
        )}

        {run?.results.map((result) => (
          <ScenarioBlock key={result.id} result={result} />
        ))}
      </Section>

      <Section title="Database">
        {summary && (
          <>
            <Table
              head={['Item', 'SKU', 'Total stock']}
              rows={summary.database.items.map((item) => [item.name, item.sku, String(item.totalStock)])}
            />
            <p className="mt-5 mb-2 text-sm font-medium">
              Reservations on file ({summary.database.reservations.length})
            </p>
            <Table
              head={['Item', 'Qty', 'From', 'To', 'Source']}
              rows={summary.database.reservations.map((row) => [
                row.itemId,
                String(row.quantity),
                row.startDate,
                row.endDate,
                row.source,
              ])}
            />
            <p className="mt-2 text-xs text-text-muted">
              Rows marked <Mono>seed</Mono> were present before any conversation.
            </p>
          </>
        )}
      </Section>

      <Section title="Latency">
        {summary && (
          <>
            <dl className="mb-4 space-y-2 text-sm">
              {Object.entries(summary.latency.definition).map(([key, value]) => (
                <div key={key}>
                  <dt className="font-mono text-xs text-text-muted">{key}</dt>
                  <dd className="text-text-muted">{String(value)}</dd>
                </div>
              ))}
            </dl>

            {summary.latency.allTurns.turnEndToAudio ? (
              <>
                <Table
                  head={['Measure', 'n', 'min', 'median', 'p95', 'max']}
                  rows={[
                    statsRow('Turn end → answer begins (ms)', summary.latency.allTurns.turnEndToAudio),
                    ...(summary.latency.allTurns.turnEndToAudible
                      ? [statsRow('Turn end → actually audible (ms)', summary.latency.allTurns.turnEndToAudible)]
                      : []),
                    ...(summary.latency.uninterrupted.turnEndToAudio
                      ? [statsRow('— of those, not after an interruption', summary.latency.uninterrupted.turnEndToAudio)]
                      : []),
                  ]}
                />
                <p className="mt-2 text-xs text-text-muted">
                  {summary.latency.totalTurns} recorded turns, of which{' '}
                  {summary.latency.uninterruptedTurns} did not follow the customer talking over the
                  agent. Interrupted turns are kept: the measurement is still real, it just answers
                  a slightly different question.
                  {summary.latency.supersededSamples > 0 &&
                    ` A further ${summary.latency.supersededSamples} samples are excluded entirely — recorded before the measurement definition was corrected.`}{' '}
                  A sample this small supports a median, not a promise.
                </p>
              </>
            ) : (
              <p className="text-sm text-text-muted">
                No timed turns recorded under the current measurement definition.
                {summary.latency.supersededSamples > 0 &&
                  ` ${summary.latency.supersededSamples} earlier samples exist but are excluded: they were recorded before the definition was corrected, and mixing them into a median would misstate it.`}{' '}
                Hold a conversation on the storefront, then reload this page.
              </p>
            )}
          </>
        )}
      </Section>

      <Section title="Cost">
        {summary?.cost.breakdown ? (
          <>
            <Table
              head={['Component', 'Tokens', 'USD']}
              rows={[
                ['Audio in', fmt(summary.cost.breakdown.audioInputTokens), usd(summary.cost.breakdown.audioInputUsd)],
                ['Audio in (cached)', fmt(summary.cost.breakdown.cachedAudioInputTokens), usd(summary.cost.breakdown.cachedAudioInputUsd)],
                ['Audio out', fmt(summary.cost.breakdown.audioOutputTokens), usd(summary.cost.breakdown.audioOutputUsd)],
                ['Text in', fmt(summary.cost.breakdown.textInputTokens), usd(summary.cost.breakdown.textInputUsd)],
                ['Text out', fmt(summary.cost.breakdown.textOutputTokens), usd(summary.cost.breakdown.textOutputUsd)],
                ['Transcription of input', '—', usd(summary.cost.breakdown.transcriptionUsd)],
                ['Total', '', usd(summary.cost.breakdown.totalUsd)],
              ]}
            />
            <p className="mt-3 text-sm">
              <strong className="font-mono">
                {usd(summary.cost.breakdown.usdPerMinute ?? 0)} per minute
              </strong>{' '}
              <span className="text-text-muted">
                over {summary.cost.breakdown.minutes.toFixed(1)} recorded minutes and{' '}
                {summary.cost.breakdown.responses} responses. Token counts are the ones the API
                reported, not an estimate of speech.
              </span>
            </p>
            <HostingTable hosting={summary.cost.hosting} />
          </>
        ) : (
          <p className="text-sm text-text-muted">
            No billed responses recorded yet, so there is no cost to report — an estimate would be a
            guess. Cost is derived from the token counts the API returns with each response, so it
            appears once a conversation has been held on the storefront. Conversations recorded
            before token logging was added do not contribute.
          </p>
        )}
      </Section>

      <Section title="Conversations">
        {summary && summary.sessions.length > 0 ? (
          <Table
            head={['Session', 'Started', 'Minutes', 'Turns', 'Tool calls', 'Interruptions', 'Bookings']}
            rows={summary.sessions.map((session) => [
              session.id.slice(0, 8),
              session.startedAt.slice(11, 19),
              session.minutes.toFixed(1),
              String(session.counts.latency ?? 0),
              String(session.counts.tool_call ?? 0),
              String(session.counts.barge_in ?? 0),
              String(session.counts.booking_confirmed ?? 0),
            ])}
          />
        ) : (
          <p className="text-sm text-text-muted">No conversations recorded yet.</p>
        )}
      </Section>
    </main>
  )
}

function ScenarioBlock({ result }: { result: ScenarioResult }) {
  return (
    <article className="mt-4 rounded-[var(--radius)] border border-border bg-surface p-4">
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-sm">{result.id}</span>
        <h3 className="font-medium">{result.title}</h3>
        <span className="font-mono text-xs text-text-muted">{result.requirements.join(' ')}</span>
        <span className={`ml-auto text-sm font-medium ${result.passed ? 'text-ok' : 'text-warn'}`}>
          {result.passed ? 'PASS' : 'FAIL'}
        </span>
      </div>

      <p className="mt-1 text-sm text-text-muted">{result.given}</p>

      <p className="mt-3 text-xs font-medium tracking-wide text-text-muted uppercase">Said</p>
      <ul className="mt-1 space-y-0.5 text-sm">
        {result.steps
          .filter((step) => step.spoken)
          .map((step, index) => (
            <li key={index}>&ldquo;{step.spoken}&rdquo;</li>
          ))}
      </ul>

      <p className="mt-3 text-xs font-medium tracking-wide text-text-muted uppercase">Checks</p>
      <Table
        head={['Check', 'Expected', 'Actual', '']}
        rows={result.checks.map((check) => [
          check.label,
          JSON.stringify(check.expected ?? null),
          JSON.stringify(check.actual ?? null),
          check.passed ? 'PASS' : 'FAIL',
        ])}
      />

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <SnapshotBlock title="Database before" snapshot={result.before} />
        <SnapshotBlock title="Database after" snapshot={result.after} />
      </div>
    </article>
  )
}

function SnapshotBlock({ title, snapshot }: { title: string; snapshot: Snapshot }) {
  return (
    <div className="rounded-lg border border-border bg-surface-2 p-3">
      <p className="text-xs font-medium tracking-wide text-text-muted uppercase">
        {title} ({snapshot.total})
      </p>
      <ul className="mt-1.5 space-y-0.5 font-mono text-xs">
        {snapshot.reservations.map((row, index) => (
          <li key={index}>
            {row.itemId} ×{row.quantity} {row.startDate}→{row.endDate} ({row.source})
          </li>
        ))}
      </ul>
    </div>
  )
}

function HostingTable({ hosting }: { hosting: Summary['cost']['hosting'] }) {
  const total = (rows: Array<{ usdPerMonth: number }>) =>
    rows.reduce((sum, row) => sum + row.usdPerMonth, 0)

  return (
    <div className="mt-5">
      <p className="mb-2 text-sm font-medium">Hosting, reported separately</p>
      <Table
        head={['Service', 'USD / month', 'Note']}
        rows={[
          ...hosting.current.map((row) => [row.item, usd(row.usdPerMonth), row.note]),
          ['Current total', usd(total(hosting.current)), ''],
          ...hosting.ifRunCommercially.map((row) => [row.item, usd(row.usdPerMonth), row.note]),
          ['If run commercially', usd(total(hosting.ifRunCommercially)), ''],
        ]}
      />
      <p className="mt-2 text-xs text-text-muted">
        Free credit is valued at list price above; the free tiers are free to us, not free to run.
      </p>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-border py-8">
      <h2 className="mb-4 text-sm font-medium tracking-wide text-text-muted uppercase">{title}</h2>
      {children}
    </section>
  )
}

function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left">
            {head.map((cell) => (
              <th key={cell} className="py-1.5 pr-4 text-xs font-medium text-text-muted">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-b border-border/60">
              {row.map((cell, cellIndex) => (
                <td
                  key={cellIndex}
                  className={`py-1.5 pr-4 align-top ${cellIndex === 0 ? '' : 'font-mono text-xs'} ${
                    cell === 'PASS' ? 'text-ok' : cell === 'FAIL' ? 'text-warn' : ''
                  }`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Mono({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-xs">{children}</span>
}

function statsRow(label: string, stats: Stats): string[] {
  return [
    label,
    String(stats.count),
    String(stats.min),
    String(stats.median),
    String(stats.p95),
    String(stats.max),
  ]
}

function fmt(value: number): string {
  return value.toLocaleString('en-US')
}

function usd(value: number): string {
  if (value === 0) return '$0'
  return value < 0.01 ? `$${value.toFixed(5)}` : `$${value.toFixed(2)}`
}
