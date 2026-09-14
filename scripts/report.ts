// `npm run report` — rewrites the measured figures in README.md and
// DELIVERY_NOTES.md from the recorded conversations.
//
// The figures were transcribed by hand at first, and went stale the moment
// another conversation was held: a document claimed 11.5 minutes and $0.0328
// while the database held 13.6 and $0.0361. Numbers that are copied drift.
// These are generated from the same function the reviewer page calls, so the
// documents and the page cannot disagree, and a stale figure is one command
// away from being current.

import { readFileSync, writeFileSync } from 'node:fs'

import { buildReport } from '@/lib/report'

type Stats = { count: number; min: number; median: number; p95: number; max: number } | null

const FILES = ['README.md', 'DELIVERY_NOTES.md']

async function main() {
  const report = await buildReport()
  const measuredOn = new Date().toISOString().slice(0, 10)

  const blocks: Record<string, string> = {
    latency: latencyBlock(report, measuredOn),
    cost: costBlock(report, measuredOn),
    counts: countsBlock(report),
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
    out += ` ${l.audibleDiscarded} audible reading(s) dropped as impossible — the onset detector caught the previous answer still playing out after a barge-in.`
  }
  if (l.answerNotMeasured > 0) {
    out += ` The answer time is not measurable on ${l.answerNotMeasured} turn(s) recorded before the client counted lookups correctly.`
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
  return (
    `${report.sessions.length} recorded conversations, ${report.latency.totalTurns} turns, ` +
    `${voice} bookings made by voice.`
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
