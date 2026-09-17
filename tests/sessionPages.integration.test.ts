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

/** Shaped like the built index.html: the generator rewrites this, so the
 *  test would catch a tag renamed in one place and not the other. */
const INDEX = `<!doctype html>
<html lang="ms">
  <head>
    <title>Geng Turun Peluh</title>
    <meta name="description" content="Booking sesi bola Geng Turun Peluh." />
    <meta property="og:title" content="Geng Turun Peluh 30+" />
    <meta property="og:description" content="Booking sesi bola Geng Turun Peluh." />
    <meta property="og:url" content="https://valehelle.github.io/sepak/" />
    <meta property="og:image" content="https://valehelle.github.io/sepak/og.jpg" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="Geng Turun Peluh 30+" />
    <meta name="twitter:description" content="Booking sesi bola Geng Turun Peluh." />
    <script type="module" crossorigin src="/sepak/assets/index-abc123.js"></script>
  </head>
  <body><div id="root"></div></body>
</html>`

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

  it('replaces the site-wide tags with the session own values', () => {
    const html = sessionPreviewHtml(INDEX, SESSION, OPTS)
    expect(html).toContain('<meta property="og:title" content="Sesi 006 GTP Session" />')
    expect(html).toContain('<meta property="og:description" content="23 Sep 2026 · 8:00 PM · Percint 8 · RM 25/pax" />')
    expect(html).toContain('<meta property="og:url" content="https://valehelle.github.io/sepak/s/b8630d98-cc10-47f0-b709-ca2343b25a3b" />')
    expect(html).toContain('<title>Sesi 006 GTP Session</title>')
    expect(html).not.toContain('Booking sesi bola Geng Turun Peluh.')
    expect(html).not.toContain('Geng Turun Peluh 30+')
  })

  it('keeps the page a working copy of the app, not a stub', () => {
    const html = sessionPreviewHtml(INDEX, SESSION, OPTS)
    // The bundle and the banner are untouched: this file IS the app, served
    // at the URL people share.
    expect(html).toContain('src="/sepak/assets/index-abc123.js"')
    expect(html).toContain('<div id="root"></div>')
    expect(html).toContain('<meta property="og:image" content="https://valehelle.github.io/sepak/og.jpg" />')
    expect(html).toContain('twitter:card" content="summary_large_image"')
    expect(html).not.toContain('location.replace')
  })

  it('escapes a title that would otherwise break out of the attribute', () => {
    const html = sessionPreviewHtml(INDEX, { ...SESSION, title: 'Ali "The Wall" & Co <b>' }, OPTS)
    expect(html).toContain('content="Sesi 006 Ali &quot;The Wall&quot; &amp; Co &lt;b&gt;"')
    expect(html).not.toContain('Co <b>')
  })

  it('fails the build rather than silently shipping the generic preview', () => {
    expect(() => sessionPreviewHtml('<html><head></head></html>', SESSION, OPTS)).toThrow(/no <title>/)
    expect(() => sessionPreviewHtml(INDEX.replace('property="og:title"', 'property="og:name"'), SESSION, OPTS))
      .toThrow(/og:title/)
  })
})
