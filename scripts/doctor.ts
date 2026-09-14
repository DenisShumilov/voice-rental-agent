// `npm run doctor` — enforces the "one thing, one place" rule.
//
// Every value a reviewer might ask us to change on a live call belongs to
// exactly one config file. If one of those values is hardcoded anywhere else,
// a one-line edit silently turns into a file hunt. This catches that.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

type Rule = {
  what: string
  /** Files allowed to contain these literals. Usually one; more only with a
   *  reason, because each extra owner weakens the rule. */
  owners: string[]
  literals: string[]
}

const RULES: Rule[] = [
  {
    what: 'item names',
    owners: ['src/config/catalog.ts'],
    literals: ['Camera A', 'Tripod B', 'Microphone C'],
  },
  {
    what: 'seeded booking dates',
    owners: ['src/config/seed.ts'],
    literals: ['2026-10-10', '2026-10-12'],
  },
  {
    what: 'model id and voice settings',
    // pricing.ts is a second owner on purpose: there a model id is the KEY of
    // a price row, not a setting. The table lists tiers we do not use, so it
    // cannot be derived from the one we do.
    owners: ['src/config/agent.ts', 'src/config/pricing.ts'],
    literals: ['gpt-realtime', 'server_vad'],
  },
  {
    what: 'brand identity',
    owners: ['src/config/brand.ts'],
    literals: ['Aperture Rentals'],
  },
]

const SCAN_ROOTS = ['src', 'scripts']
const SCAN_EXTENSIONS = ['.ts', '.tsx']

/** This file lists the literals it hunts for, so it must not check itself. */
const SELF = 'scripts/doctor.ts'

type Violation = {
  file: string
  line: number
  literal: string
  rule: Rule
}

function main() {
  const files = SCAN_ROOTS.flatMap((root) => walk(resolve(process.cwd(), root)))
  const violations: Violation[] = []

  for (const file of files) {
    const relativePath = relative(process.cwd(), file).replaceAll('\\', '/')
    if (relativePath === SELF) continue

    const contents = readFileSync(file, 'utf8').split('\n')

    for (const rule of RULES) {
      if (rule.owners.includes(relativePath)) continue

      contents.forEach((line, index) => {
        if (line.trimStart().startsWith('//')) return

        for (const literal of rule.literals) {
          if (line.includes(literal)) {
            violations.push({ file: relativePath, line: index + 1, literal, rule })
          }
        }
      })
    }
  }

  if (violations.length === 0) {
    console.log(`doctor: clean — ${files.length} files scanned, ${RULES.length} rules checked`)
    return
  }

  console.error(`doctor: ${violations.length} violation(s) of "one thing, one place"\n`)
  for (const violation of violations) {
    console.error(`  ${violation.file}:${violation.line}`)
    console.error(`    found "${violation.literal}" (${violation.rule.what})`)
    console.error(`    it belongs only in ${violation.rule.owners.join(' or ')}\n`)
  }
  process.exit(1)
}

function walk(directory: string): string[] {
  let entries: string[]
  try {
    entries = readdirSync(directory)
  } catch {
    return []
  }

  return entries.flatMap((entry) => {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) return walk(path)
    return SCAN_EXTENSIONS.some((extension) => path.endsWith(extension)) ? [path] : []
  })
}

main()
