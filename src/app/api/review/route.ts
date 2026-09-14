// The reviewer page's data, read-only. No secrets: prices and model names are
// public, and confirmation tokens never leave the server.
//
// The aggregation itself lives in src/lib/report.ts, so the documents and this
// page are produced by the same code.

import { NextResponse } from 'next/server'

import { buildReport } from '@/lib/report'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json(await buildReport())
}
