// Regression: a smoke test against the running server found every API route
// returning 500, because .env ships with `DATABASE_URL=` and an empty string is
// not undefined. The fallback now treats blank as unset.

import { afterEach, describe, expect, it } from 'vitest'

import { closeDb, getDb } from '@/lib/db'

// process.env is shared with every other test file, and each of them points
// DATABASE_URL at its own scratch database. Deleting the key here rather than
// restoring it made the suite fail intermittently: another file's next getDb()
// would see no URL, reopen the default database mid-test, and lose its rows.
const saved = {
  url: process.env.DATABASE_URL,
  token: process.env.DATABASE_AUTH_TOKEN,
}

function restore(key: 'DATABASE_URL' | 'DATABASE_AUTH_TOKEN', value: string | undefined) {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

afterEach(() => {
  closeDb()
  restore('DATABASE_URL', saved.url)
  restore('DATABASE_AUTH_TOKEN', saved.token)
})

describe('getDb', () => {
  it('falls back to the local file when DATABASE_URL is blank', () => {
    process.env.DATABASE_URL = ''
    process.env.DATABASE_AUTH_TOKEN = ''

    expect(() => getDb()).not.toThrow()
  })

  it('falls back to the local file when DATABASE_URL is only whitespace', () => {
    process.env.DATABASE_URL = '   '

    expect(() => getDb()).not.toThrow()
  })
})
