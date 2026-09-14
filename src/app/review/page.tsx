'use client'

// The reviewer's page. Not part of the customer experience.
//
// Everything here is produced by running the real system: the checks drive the
// same tool layer the voice agent uses, the database rows are the actual rows,
// and the latency and cost figures come from recorded sessions. Nothing on this
// page is illustrative.

import { useCallback, useEffect, useState } from 'react'

import { COPY } from '@/config/copy'

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
    items: Array<{ name: string; totalStock: number }>
    seeded: Array<{ itemId: string; quantity: number; startDate: string; endDate: string }>
    reservations: Snapshot['reservations']
  }
  sessions: Array<{ id: string; startedAt: string; minutes: number; counts: Record<string, number> }>
  latency: {
    definition: Record<string, unknown>
    supersededSamples: number
    totalTurns: number
    uninterruptedTurns: number
    allTurns: {
      turnEndToAudio: Stats | null
      turnEndToAudible: Stats | null
      turnEndToAnswer: Stats | null
    }
    answerNotMeasured: number
    audibleDiscarded: number
    uninterrupted: { turnEndToAudio: Stats | null; turnEndToAudible: Stats | null }
    withLookup: { turns: number; turnEndToAudio: Stats | null; turnEndToAnswer: Stats | null }
    withoutLookup: { turns: number; turnEndToAudio: Stats | null }
    samples: Array<Record<string, unknown>>
  }
  cost: {
    breakdown: Record<string, number> | null
    ifFullTier: Record<string, number> | null
    voiceMinutes: number
    pricing: {
      verifiedOn: string
      source: string
      realtimeMini: Record<string, string | number>
      realtimeFull: Record<string, string | number>
      transcription: { model: string; usdPerMinute: number }
      anchor: { model: string; usdPerMinute: number }
    }
    hosting: {
      verifiedOn: string
      sources: string[]
      current: Array<{ item: string; usdPerMonth: number; note: string }>
      atListPrice: Array<{ item: string; usdPerMonth: number; note: string }>
    }
  }
  checks: { total: number }
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
    <main className="mx-auto max-w-5xl px-5 py-8 lg:px-8">
      <header className="flex items-baseline justify-between border-b border-border pb-5">
        <span className="text-lg font-semibold tracking-tight">{COPY.name}</span>
        <a href="/" className="text-sm text-text-muted underline-offset-4 hover:underline">
          Back to the storefront
        </a>
      </header>

      <section className="py-12">
        <h1 className="max-w-2xl text-4xl leading-[1.1] font-semibold tracking-tight sm:text-5xl">
          Evidence, not a dashboard.
        </h1>
        <p className="mt-4 max-w-xl text-base text-text-muted">
          The checks below drive the same tool layer the voice agent uses. The rows are the real
          rows, and the latency and cost figures come from recorded conversations. Nothing here is
          illustrative.
        </p>

        <button
          type="button"
          onClick={runChecks}
          disabled={running}
          className="mt-7 inline-flex items-center gap-2.5 rounded-xl bg-accent px-6 py-3.5 text-base font-medium text-accent-fg transition hover:opacity-90 disabled:opacity-50"
        >
          {running ? 'Running…' : 'Run all checks'}
        </button>

        {run && (
          <p className={`mt-3 text-sm ${run.passed ? 'text-ok' : 'text-warn'}`}>
            {run.passed ? 'All checks passed' : 'Some checks failed'} ·{' '}
            <span className="font-mono text-xs text-text-muted">{run.ranAt}</span>
          </p>
        )}

        {!summary && !error && (
          <p className="mt-3 text-sm text-text-muted">Reading the recorded evidence…</p>
        )}

        {error && (
          <p className="mt-3 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-warn">
            {error}
          </p>
        )}
      </section>

      {summary && <Headline summary={summary} run={run} />}

      <Section
        title="Required checks"
        meta={
          run
            ? `${run.results.filter((result) => result.passed).length} of ${run.results.length} passed`
            : `${summary?.checks.total ?? ''} scenarios — not run yet`
        }
      >
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

      <Section
        title="Database"
        meta={summary ? `${summary.database.reservations.length} reservations on file` : undefined}
      >
        {summary && (
          <>
            <Table
              head={['Item', 'Total stock']}
              rows={summary.database.items.map((item) => [item.name, String(item.totalStock)])}
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

      <Section
        title="Latency"
        meta={summary ? `${summary.latency.totalTurns} recorded turns` : undefined}
      >
        {summary && (
          <>
            {summary.latency.allTurns.turnEndToAudio ? (
              <>
                <Table
                  head={['Measure', 'n', 'min', 'median', 'p95', 'max']}
                  rows={[
                    statsRow('Turn end → any audio begins (ms)', summary.latency.allTurns.turnEndToAudio),
                    ...(summary.latency.allTurns.turnEndToAudible
                      ? [statsRow('Turn end → actually audible (ms)', summary.latency.allTurns.turnEndToAudible)]
                      : []),
                    ...(summary.latency.allTurns.turnEndToAnswer
                      ? [statsRow('Turn end → the answer itself (ms)', summary.latency.allTurns.turnEndToAnswer)]
                      : []),
                    ...(summary.latency.uninterrupted.turnEndToAudio
                      ? [
                          statsRow(
                            'Turn end → any audio, excluding turns after an interruption',
                            summary.latency.uninterrupted.turnEndToAudio,
                          ),
                        ]
                      : []),
                  ]}
                />

                {summary.latency.withLookup.turns > 0 && (
                  <>
                    <p className="mt-5 mb-2 text-sm font-medium">
                      Where the time actually goes
                    </p>
                    <Table
                      head={['Turn type', 'n', 'min', 'median', 'p95', 'max']}
                      rows={[
                        ...(summary.latency.withoutLookup.turnEndToAudio
                          ? [statsRow(`No database lookup — answer`, summary.latency.withoutLookup.turnEndToAudio)]
                          : []),
                        ...(summary.latency.withLookup.turnEndToAudio
                          ? [statsRow(`Lookup — acknowledgement`, summary.latency.withLookup.turnEndToAudio)]
                          : []),
                        ...(summary.latency.withLookup.turnEndToAnswer
                          ? [statsRow(`Lookup — the answer`, summary.latency.withLookup.turnEndToAnswer)]
                          : []),
                      ]}
                    />
                    <p className="mt-2 text-xs text-text-muted">
                      A turn needing a lookup costs the model two passes: one to call the tool,
                      one to speak the result. The agent now acknowledges before looking up, which
                      removes the silence — it does not make the answer arrive sooner. Both rows
                      are here so the acknowledgement cannot be read as a speed-up.
                    </p>
                  </>
                )}
                <p className="mt-2 text-xs text-text-muted">
                  {summary.latency.totalTurns} recorded turns, of which{' '}
                  {summary.latency.uninterruptedTurns} did not follow the customer talking over the
                  agent. Interrupted turns are kept: the measurement is still real, it just answers
                  a slightly different question.
                  {summary.latency.audibleDiscarded > 0 &&
                    ` ${summary.latency.audibleDiscarded} audible ${summary.latency.audibleDiscarded === 1 ? "reading is" : "readings are"} dropped as impossible: the detector caught the previous answer still playing out after a barge-in, so it claimed a turn was heard before its audio was sent.`}
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

            <details className="mt-5">
              <summary className="cursor-pointer text-sm font-medium">
                How each figure was measured
              </summary>
              <dl className="mt-3 space-y-3 text-sm">
                {Object.entries(summary.latency.definition)
                  .filter(([key]) => key !== 'vadSilenceMs')
                  .map(([key, value]) => (
                    <div key={key}>
                      <dt className="font-medium">{MEASURE_LABELS[key] ?? key}</dt>
                      <dd className="text-text-muted">{String(value)}</dd>
                    </div>
                  ))}
                <div>
                  <dt className="font-medium">The silence window</dt>
                  <dd className="text-text-muted">
                    {String(summary.latency.definition.vadSilenceMs)} ms, added back to every
                    figure above.
                  </dd>
                </div>
              </dl>
            </details>
          </>
        )}
      </Section>

      <Section
        title="Cost"
        meta={
          summary?.cost.breakdown
            ? `${summary.cost.breakdown.minutes.toFixed(1)} recorded minutes`
            : undefined
        }
      >
        {summary?.cost.breakdown ? (
          <>
            <Table
              head={['Component', 'Tokens', 'USD']}
              rows={[
                ['Audio out (speech generation)', fmt(summary.cost.breakdown.audioOutputTokens), usd(summary.cost.breakdown.audioOutputUsd)],
                ['Transcription of input', '—', usd(summary.cost.breakdown.transcriptionUsd)],
                ['Audio in', fmt(summary.cost.breakdown.audioInputTokens), usd(summary.cost.breakdown.audioInputUsd)],
                ['Audio in (cached)', fmt(summary.cost.breakdown.cachedAudioInputTokens), usd(summary.cost.breakdown.cachedAudioInputUsd)],
                ['Text out (incl. reasoning)', fmt(summary.cost.breakdown.textOutputTokens), usd(summary.cost.breakdown.textOutputUsd)],
                ['Text in', fmt(summary.cost.breakdown.textInputTokens), usd(summary.cost.breakdown.textInputUsd)],
                ['Text in (cached)', fmt(summary.cost.breakdown.cachedTextInputTokens), usd(summary.cost.breakdown.cachedTextInputUsd)],
                ['Total', '', usd(summary.cost.breakdown.totalUsd)],
              ]}
            />
            <p className="mt-2 text-xs text-text-muted">
              Every row above is charged, and the total is their exact sum. The rows are printed
              rounded to four decimals, so adding up what is on screen can miss the total by a
              hundredth of a cent. Cached tokens are a subset of the input counts, so they are
              billed at the cached rate and subtracted from the uncached row rather than added on
              top.
            </p>
            <p className="mt-3 text-sm">
              <strong className="font-mono">
                {usd(summary.cost.breakdown.usdPerMinute ?? 0)} per minute
              </strong>{' '}
              <span className="text-text-muted">
                over {summary.cost.breakdown.minutes.toFixed(1)} recorded minutes and{' '}
                {summary.cost.breakdown.responses} responses. The token counts are the ones the
                API reported, not an estimate of speech. A minute here is wall-clock conversation —
                first to last recorded event in a session, summed across sessions — not minutes of
                audio, so it includes the time the customer spent thinking.
              </span>
            </p>
            <p className="mt-5 mb-2 text-sm font-medium">Rates these figures were multiplied by</p>
            <Table
              head={['Item', 'Rate']}
              rows={[
                ['Model', String(summary.agent.model)],
                ['Audio in / out, per 1M tokens', `$${summary.cost.pricing.realtimeMini.audioInput} / $${summary.cost.pricing.realtimeMini.audioOutput}`],
                ['Cached audio in, per 1M tokens', `$${summary.cost.pricing.realtimeMini.audioInputCached}`],
                ['Text in / cached / out, per 1M tokens', `$${summary.cost.pricing.realtimeMini.textInput} / $${summary.cost.pricing.realtimeMini.textInputCached} / $${summary.cost.pricing.realtimeMini.textOutput}`],
                [`Transcription (${summary.cost.pricing.transcription.model}), per minute`, `$${summary.cost.pricing.transcription.usdPerMinute}`],
                ['Verified on', summary.cost.pricing.verifiedOn],
              ]}
            />
            <p className="mt-2 text-xs text-text-muted">
              Read from {summary.cost.pricing.source} on {summary.cost.pricing.verifiedOn}. Sanity
              check: the same vendor bills its flat-rate voice model{' '}
              <Mono>{summary.cost.pricing.anchor.model}</Mono> at $
              {summary.cost.pricing.anchor.usdPerMinute} per minute, so a computed figure far from
              that order would mean the arithmetic is wrong.
            </p>

            {summary.cost.ifFullTier?.usdPerMinute != null &&
              summary.cost.breakdown.usdPerMinute != null && (
                <p className="mt-3 text-sm text-text-muted">
                  <strong className="font-medium text-text">Why the cheaper tier.</strong> The same
                  recorded tokens priced at the full{' '}
                  <Mono>{summary.cost.pricing.realtimeFull.model}</Mono> tier come to{' '}
                  <span className="font-mono">
                    {usd(summary.cost.ifFullTier.usdPerMinute)} per minute
                  </span>
                  , which is{' '}
                  {(
                    summary.cost.ifFullTier.usdPerMinute / summary.cost.breakdown.usdPerMinute
                  ).toFixed(1)}
                  × what we pay. Every decision that has to be correct is made by the database, so
                  the model only has to hear and speak — that does not need the stronger tier.
                  Transcription is billed per minute either way, so both figures include it.
                </p>
              )}

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

      <Section
        title="Conversations"
        meta={summary ? `${summary.sessions.length} recorded` : undefined}
      >
        {!summary ? null : summary.sessions.length > 0 ? (
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

/** The four numbers a reviewer came for, before any prose. */
function Headline({ summary, run }: { summary: Summary; run: RunResponse | null }) {
  const answer = summary.latency.withoutLookup.turnEndToAudio
  const cost = summary.cost.breakdown
  const bookings = summary.database.reservations.filter((row) => row.source === 'voice').length

  const figures = [
    {
      value: run
        ? `${run.results.filter((result) => result.passed).length} / ${run.results.length}`
        : `— / ${summary.checks.total}`,
      label: run ? 'required checks passed' : 'required checks',
      note: run ? `run at ${run.ranAt}` : 'not run yet — press Run all checks',
    },
    {
      value: answer ? `${answer.median} ms` : '—',
      label: 'turn end → answer',
      note: answer ? `median of ${answer.count} turns, no lookup` : 'no turns recorded',
    },
    {
      value: cost ? `$${cost.usdPerMinute.toFixed(4)}` : '—',
      label: 'per minute of conversation',
      note: cost ? `measured over ${cost.minutes.toFixed(1)} min` : 'no billed responses yet',
    },
    {
      value: String(bookings),
      label: 'bookings made by voice',
      note: `${summary.sessions.length} recorded conversations`,
    },
  ]

  return (
    <dl className="grid gap-4 pb-12 sm:grid-cols-2 lg:grid-cols-4">
      {figures.map((figure) => (
        <div
          key={figure.label}
          className="rounded-[var(--radius)] border border-border bg-surface p-4"
        >
          <dd className="font-mono text-2xl">{figure.value}</dd>
          <dt className="mt-1 text-sm font-medium">{figure.label}</dt>
          <p className="mt-0.5 text-xs text-text-muted">{figure.note}</p>
        </div>
      ))}
    </dl>
  )
}

function ScenarioBlock({ result }: { result: ScenarioResult }) {
  return (
    <article
      className={`mt-4 overflow-hidden rounded-[var(--radius)] border border-border bg-surface border-l-[3px] ${
        result.passed ? 'border-l-[var(--ok)]' : 'border-l-[var(--warn)]'
      }`}
    >
      <div className="p-4">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-mono text-sm text-text-muted">{result.id}</span>
          <h3 className="font-medium">{result.title}</h3>
          <span className="ml-auto">
            <Verdict passed={result.passed} />
          </span>
        </div>

        <p className="mt-1.5 text-sm text-text-muted">{result.given}</p>

        <p className="mt-3.5 text-xs font-medium tracking-wide text-text-muted uppercase">
          What was said
        </p>
        <ul className="mt-1.5 space-y-1.5">
          {result.steps
            .filter((step) => step.spoken)
            .map((step, index) => (
              <li
                key={index}
                className="max-w-[90%] rounded-2xl rounded-bl-sm bg-surface-2 px-3 py-1.5 text-sm"
              >
                {step.spoken}
              </li>
            ))}
        </ul>

        <p className="mt-3.5 text-xs font-medium tracking-wide text-text-muted uppercase">
          Checks
        </p>
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
          <SnapshotBlock
            title="Database after"
            snapshot={result.after}
            addedSince={result.before}
          />
        </div>
      </div>
    </article>
  )
}

function rowKey(row: Snapshot['reservations'][number]): string {
  return `${row.itemId}|${row.quantity}|${row.startDate}|${row.endDate}`
}

function SnapshotBlock({
  title,
  snapshot,
  addedSince,
}: {
  title: string
  snapshot: Snapshot
  /** Rows absent from this set are marked as written by the scenario. */
  addedSince?: Snapshot
}) {
  const before = new Set((addedSince?.reservations ?? []).map(rowKey))

  return (
    <div className="rounded-lg border border-border bg-surface-2 p-3">
      <p className="text-xs font-medium tracking-wide text-text-muted uppercase">
        {title} · {snapshot.total} {snapshot.total === 1 ? 'row' : 'rows'}
      </p>
      <ul className="mt-2 space-y-1 font-mono text-xs">
        {snapshot.reservations.map((row, index) => {
          const isNew = addedSince !== undefined && !before.has(rowKey(row))
          return (
            <li key={index} className={isNew ? 'font-medium text-ok' : 'text-text-muted'}>
              {isNew ? '+ ' : '  '}
              {row.itemId} ×{row.quantity} {row.startDate}→{row.endDate}
              {isNew && <span className="ml-1.5 font-sans not-italic">written by this check</span>}
            </li>
          )
        })}
        {snapshot.reservations.length === 0 && <li className="text-text-muted">(empty)</li>}
      </ul>
    </div>
  )
}

function Verdict({ passed }: { passed: boolean }) {
  return (
    <span
      className={`rounded-md px-2 py-0.5 text-xs font-semibold tracking-wide ${
        passed ? 'bg-[var(--ok)]/10 text-ok' : 'bg-[var(--warn)]/15 text-warn'
      }`}
    >
      {passed ? 'PASS' : 'FAIL'}
    </span>
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
          ...hosting.atListPrice.map((row) => [row.item, usd(row.usdPerMonth), row.note]),
          ['List price of those same tiers', usd(total(hosting.atListPrice)), ''],
        ]}
      />
      <p className="mt-2 text-xs text-text-muted">
        This runs on free tiers, so hosting costs us nothing — but a free tier is not a free
        service, so the list price of the same capacity is shown beside it rather than reported as
        zero. Read from {hosting.sources.join(' and ')} on {hosting.verifiedOn}.
      </p>
    </div>
  )
}

function Section({
  title,
  meta,
  children,
}: {
  title: string
  /** Right-aligned fact, the way the storefront shelf carries its dates. */
  meta?: string
  children: React.ReactNode
}) {
  return (
    <section className="pb-12">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-2.5">
        <h2 className="text-sm font-medium tracking-wide text-text-muted uppercase">{title}</h2>
        {meta && <p className="font-mono text-xs text-text-muted">{meta}</p>}
      </div>
      <div className="mt-4">{children}</div>
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

/** The API keys are field names; a reviewer should not have to read code. */
const MEASURE_LABELS: Record<string, string> = {
  turnEndToAudioMs: 'Turn end → any audio begins',
  turnEndToAudibleMs: 'Turn end → actually audible',
  turnEndToAnswerMs: 'Turn end → the answer itself',
  followedInterruption: 'Turns that followed an interruption',
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
  // Four decimals below a dollar: rounding fractions of a cent to two hides
  // exactly the differences this table exists to show.
  if (value < 0.001) return `$${value.toFixed(5)}`
  if (value < 1) return `$${value.toFixed(4)}`
  return `$${value.toFixed(2)}`
}
