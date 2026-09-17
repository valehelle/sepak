// Per-session share previews.
//
// WhatsApp, Telegram and Facebook never run the app's JavaScript: they fetch
// the URL and read the Open Graph tags out of the HTML as served. A
// single-page app therefore has exactly one preview, however many sessions
// it holds -- which is why every link showed the same generic card.
//
// This writes a real file per session at `s/<id>/index.html`, carrying that
// session's own title and a description led by the date, which is what
// people actually want to see in the chat. The page itself is a stub: a
// crawler takes the tags, a person is sent straight into the app.
//
// Sessions created after the last build have no file yet, so their links
// fall back to the site-wide card (and the 404 shim still opens them). The
// deploy workflow rebuilds on a schedule to keep that window short.
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const MONTHS = ['Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ogo', 'Sep', 'Okt', 'Nov', 'Dis']

/** "23 Sep 2026", not the app's "23/09/2026 (RABU)". A preview line is read
 *  at a glance in a chat, where a named month cannot be misread the way a
 *  numeric one can, and the weekday is the part most easily got wrong.
 *
 *  Split rather than `new Date(iso)` for the same reason src/lib/format.ts
 *  does it: that parses a date-only string as midnight UTC and lands a day
 *  early west of Greenwich. */
export function formatPlayDate(iso) {
  const [year, month, day] = String(iso).split('-').map(Number)
  if (!year || !month || !day) throw new Error(`invalid date: ${iso}`)
  const name = MONTHS[month - 1]
  if (name === undefined) throw new Error(`invalid date: ${iso}`)
  return `${day} ${name} ${year}`
}

export function formatStartTime(time) {
  const [rawHour, rawMinute] = String(time).split(':')
  const hour = Number(rawHour)
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new Error(`invalid time: ${time}`)
  const minute = (rawMinute ?? '00').padStart(2, '0')
  const hour12 = hour % 12 === 0 ? 12 : hour % 12
  return `${hour12}:${minute} ${hour < 12 ? 'AM' : 'PM'}`
}

export function formatFee(fee) {
  if (fee === null || fee === undefined || Number(fee) === 0) return null
  const value = Number(fee)
  return `RM ${Number.isInteger(value) ? String(value) : value.toFixed(2)}/pax`
}

/** "Sesi 006 GTP Session" -- the number is how the group refers to a
 *  fixture, so it leads, exactly as it does on the page itself. */
export function previewTitle(session) {
  return `Sesi ${String(session.session_no).padStart(3, '0')} ${session.title}`
}

/** Date first: it is the one thing someone scanning a chat needs. Venue
 *  and fee follow because they settle "can I make it" and "what do I owe". */
export function previewDescription(session) {
  const fee = formatFee(session.fee_myr)
  return [
    formatPlayDate(session.play_date),
    formatStartTime(session.start_time),
    session.venue,
    ...(fee === null ? [] : [fee]),
  ].join(' · ')
}

function escapeAttribute(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** A stub, not the app: the crawler wants the tags and a person wants the
 *  session, so the tags are inline and the redirect fires immediately. The
 *  app itself routes on the fragment (see src/main.tsx), hence the form of
 *  the target. */
export function sessionPreviewHtml(session, { base, origin, image }) {
  const title = previewTitle(session)
  const description = previewDescription(session)
  const url = `${origin}${base}s/${session.id}`
  const attr = (value) => escapeAttribute(value)

  return `<!doctype html>
<html lang="ms">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <title>${attr(title)}</title>
    <meta name="description" content="${attr(description)}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Geng Turun Peluh" />
    <meta property="og:locale" content="ms_MY" />
    <meta property="og:title" content="${attr(title)}" />
    <meta property="og:description" content="${attr(description)}" />
    <meta property="og:url" content="${attr(url)}" />
    <meta property="og:image" content="${attr(`${origin}${base}og.jpg`)}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:type" content="image/jpeg" />
    <meta property="og:image:alt" content="Padang bola di bawah lampu limpah pada waktu malam" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${attr(title)}" />
    <meta name="twitter:description" content="${attr(description)}" />
    <meta name="twitter:image" content="${attr(image ?? `${origin}${base}og.jpg`)}" />
    <link rel="canonical" href="${attr(url)}" />
    <script>
      location.replace(${JSON.stringify(`${base}#/s/`)} + ${JSON.stringify(session.id)})
    </script>
  </head>
  <body></body>
</html>
`
}

/** Every session, not just the upcoming ones: a link shared months ago
 *  should still render as itself rather than decay to the generic card. */
async function fetchSessions(url, key) {
  const response = await fetch(
    `${url}/rest/v1/sessions?select=id,session_no,title,play_date,start_time,venue,fee_myr`,
    { headers: { apikey: key, Authorization: `Bearer ${key}`, 'Accept-Profile': 'sepak' } },
  )
  if (!response.ok) {
    throw new Error(`sessions fetch failed: HTTP ${response.status} ${await response.text()}`)
  }
  return response.json()
}

export async function writeSessionPages({ dist, base, origin, url, key, log = console.log }) {
  if (!url || !key) {
    // A build without credentials still has to produce a deployable site;
    // it simply ships without the per-session previews.
    log('session-pages: no Supabase credentials, skipping per-session previews')
    return 0
  }

  const sessions = await fetchSessions(url, key)
  for (const session of sessions) {
    const dir = resolve(dist, 's', session.id)
    await mkdir(dir, { recursive: true })
    await writeFile(resolve(dir, 'index.html'), sessionPreviewHtml(session, { base, origin }))
  }
  log(`session-pages: wrote ${sessions.length} per-session preview${sessions.length === 1 ? '' : 's'}`)
  return sessions.length
}
