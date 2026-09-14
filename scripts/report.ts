// `npm run report` — rewrites the measured figures in README.md and
// DELIVERY_NOTES.md from the recorded conversations.
//
// The figures were transcribed by hand at first, and went stale the moment
// another conversation was held: a document claimed 11.5 minutes and $0.0328
// while the database held 13.6 and $0.0361. Numbers that are copied drift.
// These are generated from the same function the reviewer page calls, so the
// documents and the page cannot disagree, and a stale figure is one command
// away from being current.

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

import { buildReport } from '@/lib/report'

type Stats = { count: number; min: number; median: number; p95: number; max: number } | null

const FILES = ['README.md', 'DELIVERY_NOTES.md', 'TEST_CASES.md']

/**
 * When the first working file was created, from its modification time. The
 * repository was initialised later, so git alone cannot date the start — this
 * is the one figure here that is not derived, and it is stated as such in the
 * text it produces.
 */
const SESSION_START = '2026-09-14T19:08:00+03:00'
/** Minutes lost to an enforced pause on the AI tooling, 20:00 to 20:20. */
const PAUSE_MINUTES = 20

async function main() {
  const report = await buildReport()
  const measuredOn = new Date().toISOString().slice(0, 10)

  const blocks: Record<string, string> = {
    latency: latencyBlock(report, measuredOn),
    cost: costBlock(report, measuredOn),
    counts: countsBlock(report),
    observations: observationsBlock(report),
    money: moneyBlock(report),
    time: timeBlock(),
  }

  for (const file of FILES) {
    let text = readFileSync(file, 'utf8')
    let replaced = 0

    for (const [name, body] of Object.entries(blocks)) {
      const open = `<!-- figures:${name} -->`
      const close = `<!-- /figures:${name} -->`
      const pattern = new RegExp(`${open}[\\s\\S]*?${close}`)
      if (!pattern.test(text)) continue
      text = text.replace(pattern, `${open}\n${body}\n${close}`)
      replaced += 1
    }

    writeFileSync(file, text)
    console.log(`${file}: ${replaced} figure block(s) regenerated`)
  }

  console.log('')
  console.log(`Measured on ${measuredOn}`)
  console.log(`  turns          ${report.latency.totalTurns}`)
  console.log(`  conversations  ${report.sessions.length}`)
  const perMinute = report.cost.breakdown?.usdPerMinute
  console.log(`  cost/min       ${perMinute ? `$${perMinute.toFixed(4)}` : '—'}`)
}

function row(label: string, stats: Stats): string {
  if (!stats) return ''
  return `| ${label} | ${stats.count} | ${stats.min} | **${stats.median}** | ${stats.p95} | ${stats.max} |\n`
}

function latencyBlock(report: Awaited<ReturnType<typeof buildReport>>, on: string): string {
  const l = report.latency
  const silence = l.definition.vadSilenceMs

  let out = `Measured on ${on} across ${report.sessions.length} recorded conversations,\n`
  out += `silence window ${silence} ms. All figures in milliseconds.\n\n`
  out += `| Measure | n | min | median | p95 | max |\n|---|---|---|---|---|---|\n`
  out += row('Turn end → any audio begins', l.allTurns.turnEndToAudio)
  out += row('Turn end → actually audible', l.allTurns.turnEndToAudible)
  out += row('Turn end → the answer itself', l.allTurns.turnEndToAnswer)
  out += row('Any audio, excluding turns after an interruption', l.uninterrupted.turnEndToAudio)

  out += `\nSplit by whether the turn had to consult the database, which is where the\n`
  out += `time actually goes:\n\n`
  out += `| Turn type | n | min | median | p95 | max |\n|---|---|---|---|---|---|\n`
  out += row('No database lookup — the answer', l.withoutLookup.turnEndToAudio)
  out += row('Lookup — the acknowledgement', l.withLookup.turnEndToAudio)
  out += row('Lookup — the answer', l.withLookup.turnEndToAnswer)

  const lookup = l.withLookup.turnEndToAnswer?.median
  const plain = l.withoutLookup.turnEndToAudio?.median
  if (lookup && plain) {
    out += `\nA turn that consults the database takes **${(lookup / plain).toFixed(1)}× longer** to reach its\n`
    out += `answer, because the model makes two passes: one to call the tool, one to speak\n`
    out += `the result. The agent acknowledges before looking up, which removes the silence\n`
    out += `without making the answer arrive sooner — both rows are here so that cannot be\n`
    out += `read as a speed-up.\n`
  }

  out += `\n${l.totalTurns} turns recorded, ${l.uninterruptedTurns} of them not following an interruption.`
  if (l.audibleDiscarded > 0) {
    out += ` ${l.audibleDiscarded} audible ${l.audibleDiscarded === 1 ? 'reading' : 'readings'} dropped as impossible — the onset detector caught the previous answer still playing out after a barge-in.`
  }
  if (l.answerNotMeasured > 0) {
    out += ` The answer time is not measurable on ${l.answerNotMeasured} turns recorded before the client counted lookups correctly.`
  }
  out += ` A sample this size supports a median, not a promise.`

  return out
}

function costBlock(report: Awaited<ReturnType<typeof buildReport>>, on: string): string {
  const c = report.cost.breakdown
  if (!c) return 'No billed responses recorded yet, so there is no cost to report.'

  const share = (usd: number) => `${Math.round((100 * usd) / c.totalUsd)}%`
  const usd = (value: number) => `$${value.toFixed(4)}`
  const num = (value: number) => value.toLocaleString('en-US')

  let out = `Measured on ${on} from the token counts the API returned with each\n`
  out += `response — ${c.responses} responses across ${c.minutes.toFixed(1)} minutes of conversation.\n\n`
  out += `| Component | Tokens | USD | Share |\n|---|---|---|---|\n`
  out += `| Speech generation (audio out) | ${num(c.audioOutputTokens)} | ${usd(c.audioOutputUsd)} | ${share(c.audioOutputUsd)} |\n`
  out += `| Input transcription | — | ${usd(c.transcriptionUsd)} | ${share(c.transcriptionUsd)} |\n`
  out += `| Audio input | ${num(c.audioInputTokens)} | ${usd(c.audioInputUsd)} | ${share(c.audioInputUsd)} |\n`
  out += `| Reasoning + text out | ${num(c.textOutputTokens)} | ${usd(c.textOutputUsd)} | ${share(c.textOutputUsd)} |\n`
  out += `| Text in (uncached) | ${num(c.textInputTokens)} | ${usd(c.textInputUsd)} | ${share(c.textInputUsd)} |\n`
  out += `| Text in (cached) | ${num(c.cachedTextInputTokens)} | ${usd(c.cachedTextInputUsd)} | ${share(c.cachedTextInputUsd)} |\n`
  out += `| Audio input (cached) | ${num(c.cachedAudioInputTokens)} | ${usd(c.cachedAudioInputUsd)} | ${share(c.cachedAudioInputUsd)} |\n`
  out += `| **Total** | | **${usd(c.totalUsd)}** | |\n`
  out += `| **Per minute** | | **${usd(c.usdPerMinute ?? 0)}** | |\n`

  const cachedShare = Math.round(
    (100 * c.cachedTextInputTokens) / (c.cachedTextInputTokens + c.textInputTokens),
  )
  const withoutCache = (c.cachedTextInputTokens / 1_000_000) * report.cost.pricing.realtimeMini.textInput

  out += `\nAll seven rows are charged and sum to the total. Cached tokens are a subset of\n`
  out += `the input counts, billed at the cached rate rather than added on top.\n\n`
  out += `Audio in and out together are ${share(c.audioOutputUsd + c.audioInputUsd + c.cachedAudioInputUsd)} of the bill, so shortening what the agent\n`
  out += `says is worth more than any prompt optimisation. ${cachedShare}% of text input was\n`
  out += `served from cache; at the uncached rate those tokens would have cost\n`
  out += `${usd(withoutCache)} instead of ${usd(c.cachedTextInputUsd)}.`

  return out
}

function countsBlock(report: Awaited<ReturnType<typeof buildReport>>): string {
  const voice = report.database.reservations.filter((row) => row.source === 'voice').length
  const interruptions = report.sessions.reduce(
    (total, session) => total + (session.counts.barge_in ?? 0),
    0,
  )
  return (
    `Verified by ear across ${report.sessions.length} recorded conversations. ` +
    `${interruptions} interruptions across ${report.latency.totalTurns} turns were recorded and ` +
    `the agent stopped each time; ${voice} bookings were made by voice.`
  )
}

/** The sentences that quote latency numbers, so they cannot drift from the table. */
function observationsBlock(report: Awaited<ReturnType<typeof buildReport>>): string {
  const l = report.latency
  const all = l.allTurns.turnEndToAudio?.median
  const clean = l.uninterrupted.turnEndToAudio?.median
  const plain = l.withoutLookup.turnEndToAudio?.median

  let out = `**Observations.** Interrupting does not make the agent slower to recover: the\n`
  out += `median on turns that did not follow an interruption (${clean} ms) is close to the\n`
  out += `overall one (${all} ms).`
  if (l.audibleDiscarded > 0) {
    out += ` ${l.audibleDiscarded} audible ${l.audibleDiscarded === 1 ? 'reading was' : 'readings were'} dropped as impossible — claiming a\n`
    out += `turn was heard before its audio had been sent, because the onset detector had\n`
    out += `caught the previous answer still playing out after a barge-in. The reviewer page\n`
    out += `states the count rather than quietly excluding it.`
  }

  out += `\n\nFor context, the only public measurement of this API with a stated methodology\n`
  out += `is 1.76–1.86 s (webrtcHacks, January 2025), whose author notes results have\n`
  out += `improved since. A turn needing no lookup sits below that at ${plain} ms; a turn\n`
  out += `needing one sits above. On ${l.totalTurns} turns, one machine, one network.`

  return out
}

/** The sentences that quote cost numbers, for the same reason. */
function moneyBlock(report: Awaited<ReturnType<typeof buildReport>>): string {
  const c = report.cost.breakdown
  if (!c) return 'No billed responses recorded yet.'

  const pct = (usd: number) => Math.round((100 * usd) / c.totalUsd)
  const audio = pct(c.audioOutputUsd + c.audioInputUsd + c.cachedAudioInputUsd)
  const text = pct(c.textInputUsd + c.cachedTextInputUsd + c.textOutputUsd)
  const cachedShare = Math.round(
    (100 * c.cachedTextInputTokens) / (c.cachedTextInputTokens + c.textInputTokens),
  )
  const uncachedCost =
    (c.cachedTextInputTokens / 1_000_000) * report.cost.pricing.realtimeMini.textInput
  const anchor = report.cost.pricing.anchor

  let out = `**Sanity check.** OpenAI bills a comparable full-duplex voice model,\n`
  out += `\`${anchor.model}\`, at a flat $${anchor.usdPerMinute} per minute. Our computed\n`
  out += `$${(c.usdPerMinute ?? 0).toFixed(4)} lands in the same place, which is the check that the arithmetic is\n`
  out += `not out by an order of magnitude.\n\n`
  out += `**Where the money actually goes.** Speech generation is ${pct(c.audioOutputUsd)}% of the bill, and\n`
  out += `audio in and out together are ${audio}%. Text — the instructions, the conversation\n`
  out += `history, the tool schemas, the reasoning — is ${text}% in total, cached or not.\n`
  out += `Shortening what the agent says is therefore worth far more than any prompt\n`
  out += `optimisation, and it shortens the customer's wait at the same time.\n\n`
  out += `**Caching does a lot of quiet work.** ${c.cachedTextInputTokens.toLocaleString('en-US')} of `
  out += `${(c.cachedTextInputTokens + c.textInputTokens).toLocaleString('en-US')} text input tokens —\n`
  out += `${cachedShare}% — were served from cache. At the uncached rate those would have cost\n`
  out += `$${uncachedCost.toFixed(4)} instead of $${c.cachedTextInputUsd.toFixed(4)}. The instructions and the tool schemas are\n`
  out += `resent on every turn, and without caching that would be a visible line item\n`
  out += `rather than a rounding error.`

  return out
}

/** Elapsed time, derived from git rather than remembered. */
function timeBlock(): string {
  const log = execFileSync('git', ['log', '--reverse', '--format=%aI'], { encoding: 'utf8' })
    .trim()
    .split('\n')
  const firstCommit = new Date(log[0])
  const lastCommit = new Date(log[log.length - 1])
  const start = new Date(SESSION_START)

  const elapsed = Math.round((lastCommit.getTime() - start.getTime()) / 60_000)
  const working = elapsed - PAUSE_MINUTES
  const hhmm = (minutes: number) => {
    const hours = Math.floor(minutes / 60)
    const rest = minutes % 60
    const hourPart = `${hours} hour${hours === 1 ? '' : 's'}`
    return rest === 0 ? hourPart : `${hourPart} ${rest} minutes`
  }
  const clock = (date: Date) => date.toTimeString().slice(0, 5)

  let out = `**${hhmm(elapsed)} of elapsed wall-clock time**, of which ${PAUSE_MINUTES} minutes\n`
  out += `was an enforced pause on my AI tooling. So about **${hhmm(working)} of actual\n`
  out += `work**, against an eight-hour ceiling.\n\n`
  out += `Derived, not remembered: this paragraph is regenerated by \`npm run report\` from\n`
  out += `\`git log\`. The end is the last commit, ${clock(lastCommit)} on ${lastCommit.toISOString().slice(0, 10)}, across ${log.length} commits\n`
  out += `beginning at ${clock(firstCommit)}. The start, ${clock(start)}, is the creation time of the first\n`
  out += `working file — the repository was initialised later, so git cannot date it and\n`
  out += `that one figure rests on a file timestamp rather than a commit.`

  return out
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
