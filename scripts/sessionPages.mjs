// Per-session share previews.
//
// WhatsApp, Telegram and Facebook never run the app's JavaScript: they fetch
// the URL and read the Open Graph tags out of the HTML as served. A
// single-page app therefore has exactly one preview, however many sessions
// it holds -- which is why every link showed the same generic card.
//
// This writes a real file per session at `s/<id>/index.html`: the built
// index.html with its share tags swapped for that session's own title and a
// description led by the date. It is the whole app, not a stub, so the URL
// in the address bar is both what loads the session and what previews
// correctly when pasted into a chat.
//
// Sessions created after the last build have no file yet, so their links
// fall back to the site-wide card (and the 404 shim still opens them). The
// deploy workflow rebuilds on a schedule to keep that window short.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
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

/** Replaces one tag's content, failing loudly rather than silently
 *  shipping the site-wide text: a renamed or dropped tag in index.html
 *  would otherwise turn every session's preview back into the generic one
 *  with nothing to show for it. */
function replaceTag(html, pattern, value, what) {
  if (!pattern.test(html)) throw new Error(`session preview: no ${what} in index.html`)
  return html.replace(pattern, (match, open, close) => `${open}${escapeAttribute(value)}${close}`)
}

/** The built index.html with its share tags rewritten for one session.
 *  Asset URLs inside it are absolute (Vite's base), so the same markup
 *  works from `s/<id>/` as from the root. */
export function sessionPreviewHtml(indexHtml, session, { base, origin }) {
  const title = previewTitle(session)
  const description = previewDescription(session)
  const url = `${origin}${base}s/${session.id}`

  let html = indexHtml
  html = replaceTag(html, /(<title>)[^<]*(<\/title>)/, title, '<title>')
  for (const [name, value] of [
    ['name="description"', description],
    ['property="og:title"', title],
    ['property="og:description"', description],
    ['property="og:url"', url],
    ['name="twitter:title"', title],
    ['name="twitter:description"', description],
  ]) {
    html = replaceTag(html, new RegExp(`(<meta ${name} content=")[^"]*(")`), value, name)
  }
  return html
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

  const indexHtml = await readFile(resolve(dist, 'index.html'), 'utf8')
  const sessions = await fetchSessions(url, key)
  for (const session of sessions) {
    const dir = resolve(dist, 's', session.id)
    await mkdir(dir, { recursive: true })
    await writeFile(resolve(dir, 'index.html'), sessionPreviewHtml(indexHtml, session, { base, origin }))
  }
  log(`session-pages: wrote ${sessions.length} per-session preview${sessions.length === 1 ? '' : 's'}`)
  return sessions.length
}
