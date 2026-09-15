import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'

import { COPY } from '@/config/copy'
import './globals.css'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: `${COPY.name} — ${COPY.headline}`,
  description: COPY.subheadline,
}

// Written out rather than using the generated `LayoutProps<'/'>`: that type
// lives in .next, which is git-ignored, so `npm run check` on a fresh clone
// failed to typecheck before anything had been built.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  )
}
