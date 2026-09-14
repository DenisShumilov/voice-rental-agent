// Regression: a smoke test against the running server found every API route
// returning 500, because .env ships with `DATABASE_URL=` and an empty string is
// not undefined. The fallback now treats blank as unset.

import { afterEach, describe, expect, it } from 'vitest'

import { closeDb, getDb } from '@/lib/db'

afterEach(() => {
  closeDb()
  delete process.env.DATABASE_URL
  delete process.env.DATABASE_AUTH_TOKEN
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
