import { describe, expect, it } from 'vitest'
// @ts-expect-error -- plain-Node build script, no type declarations
import { previewDescription, previewTitle, sessionPreviewHtml } from '../scripts/sessionPages.mjs'

const SESSION = {
  id: 'b8630d98-cc10-47f0-b709-ca2343b25a3b',
  session_no: 6,
  title: 'GTP Session',
  play_date: '2026-09-23',
  start_time: '20:00:00',
  venue: 'Percint 8',
  fee_myr: 25,
}

const OPTS = { base: '/sepak/', origin: 'https://valehelle.github.io' }

describe('session share previews', () => {
  it('leads the title with the session number, as the group refers to it', () => {
    expect(previewTitle(SESSION)).toBe('Sesi 006 GTP Session')
  })

  it('leads the description with a readable date, no weekday', () => {
    expect(previewDescription(SESSION)).toBe('23 Sep 2026 · 8:00 PM · Percint 8 · RM 25/pax')
  })

  it('uses Malay month names and no leading zero on the day', () => {
    expect(previewDescription({ ...SESSION, play_date: '2026-12-04' })).toContain('4 Dis 2026')
    expect(previewDescription({ ...SESSION, play_date: '2026-03-01' })).toContain('1 Mac 2026')
  })

  it('omits the fee when there is nothing to collect', () => {
    expect(previewDescription({ ...SESSION, fee_myr: null })).toBe('23 Sep 2026 · 8:00 PM · Percint 8')
    expect(previewDescription({ ...SESSION, fee_myr: 0 })).toBe('23 Sep 2026 · 8:00 PM · Percint 8')
  })

  it('renders absolute URLs, since a crawler fetches these with no page context', () => {
    const html = sessionPreviewHtml(SESSION, OPTS)
    expect(html).toContain('<meta property="og:url" content="https://valehelle.github.io/sepak/s/b8630d98-cc10-47f0-b709-ca2343b25a3b" />')
    expect(html).toContain('<meta property="og:image" content="https://valehelle.github.io/sepak/og.jpg" />')
    expect(html).toContain('twitter:card" content="summary_large_image"')
  })

  it('sends a person straight into the app', () => {
    expect(sessionPreviewHtml(SESSION, OPTS)).toContain('location.replace("/sepak/#/s/"')
  })

  it('escapes a title that would otherwise break out of the attribute', () => {
    const html = sessionPreviewHtml({ ...SESSION, title: 'Ali "The Wall" & Co <b>' }, OPTS)
    expect(html).toContain('content="Sesi 006 Ali &quot;The Wall&quot; &amp; Co &lt;b&gt;"')
    expect(html).not.toContain('<b>')
  })
})
