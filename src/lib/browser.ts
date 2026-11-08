/** A short name for the browser behind a user agent, for the organiser to
 *  tell one browser on a phone from another: "iPhone · Safari",
 *  "Android · Instagram". A booking belongs to the browser it was made in
 *  (see claimToken.ts), so this is what explains a player who cannot edit
 *  their own slot.
 *
 *  Best effort. The browser inside WhatsApp on iPhone reports itself as
 *  Safari, and Chrome Custom Tabs on Android as Chrome, so those cannot be
 *  told apart from the real thing. The full user agent is kept alongside. */
export function describeBrowser(ua: string): string {
  const device = deviceOf(ua)
  const browser = browserOf(ua)
  return device === null ? browser : `${device} · ${browser}`
}

function deviceOf(ua: string): string | null {
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/iPad/.test(ua)) return 'iPad'
  if (/Android/.test(ua)) return 'Android'
  if (/Macintosh/.test(ua)) return 'Mac'
  if (/Windows/.test(ua)) return 'Windows'
  return null
}

function browserOf(ua: string): string {
  // Apps that add their own marker come first: their user agents also carry
  // the engine's name.
  if (/WhatsApp/i.test(ua)) return 'WhatsApp'
  if (/Instagram/.test(ua)) return 'Instagram'
  if (/FBAN|FBAV|FB_IAB/.test(ua)) return 'Facebook'
  if (/musical_ly|TikTok/i.test(ua)) return 'TikTok'
  if (/Telegram/i.test(ua)) return 'Telegram'
  if (/Line\//.test(ua)) return 'LINE'
  if (/SamsungBrowser/.test(ua)) return 'Samsung Internet'
  if (/EdgiOS|EdgA|Edg\//.test(ua)) return 'Edge'
  if (/FxiOS|Firefox\//.test(ua)) return 'Firefox'
  if (/OPiOS|OPR\//.test(ua)) return 'Opera'
  if (/CriOS/.test(ua)) return 'Chrome'
  // Android WebView marks itself with "; wv)": an app showing the page
  // inside itself, with storage of its own.
  if (/Android/.test(ua) && /; wv\)/.test(ua)) return 'browser dalam app'
  if (/Chrome\//.test(ua)) return 'Chrome'
  // Real Safari on iOS says "Version/… Safari/…". A page added to the home
  // screen, or shown inside an app, drops both.
  if (/iPhone|iPad/.test(ua)) return /Safari\//.test(ua) ? 'Safari' : 'app / skrin utama'
  if (/Safari\//.test(ua)) return 'Safari'
  return 'lain-lain'
}
