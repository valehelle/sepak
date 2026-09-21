/** What this browser can actually do about notifications, which decides
 *  which of the three prompts a player sees.
 *
 *  - `ready`: we can ask for permission right now.
 *  - `needs-install`: iOS, and the app is not on the home screen. iOS
 *    refuses push to a Safari tab outright, so the only honest answer is
 *    instructions.
 *  - `blocked`: permission was refused before. A browser will not let us ask
 *    twice, so this has to be undone in settings.
 *  - `unsupported`: no push at all. Nothing to offer.
 */
export type PushCapability = 'ready' | 'needs-install' | 'blocked' | 'unsupported'

/** Reflect.get rather than a cast: `navigator.standalone` is a non-standard
 *  iOS property that TypeScript's lib does not know about, and reading it
 *  through Reflect keeps the value `unknown` instead of asserting a shape. */
function iosStandaloneFlag(): boolean {
  try {
    return Reflect.get(window.navigator, 'standalone') === true
  } catch {
    return false
  }
}

/** Launched from the home screen (iOS) or installed (everywhere else). */
export function isStandalone(): boolean {
  if (iosStandaloneFlag()) return true
  try {
    return window.matchMedia('(display-mode: standalone)').matches
  } catch {
    return false
  }
}

export function isIos(): boolean {
  const ua = navigator.userAgent
  if (/iPad|iPhone|iPod/.test(ua)) return true
  // iPadOS 13+ reports itself as a Mac; the touch points are what give it
  // away, and they matter because an iPad has the same install requirement.
  return ua.includes('Macintosh') && navigator.maxTouchPoints > 1
}

/** In-app and third-party browsers on iOS cannot install a web app that
 *  receives push: the home-screen entry has to come from Safari. Worth
 *  detecting, because the instructions are otherwise a dead end the player
 *  follows all the way to the bottom before finding out. */
export function isIosNonSafari(): boolean {
  if (!isIos()) return false
  const ua = navigator.userAgent
  // CriOS/FxiOS/EdgiOS are the WebKit-wrapped browsers; FBAN/FBAV and
  // Instagram are the in-app ones a WhatsApp link can land in.
  return /CriOS|FxiOS|EdgiOS|OPiOS|FBAN|FBAV|Instagram|Line\//.test(ua)
}

export function pushCapability(): PushCapability {
  const supported =
    'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

  // On iOS the APIs are present in a tab but the permission request is
  // refused, so the install requirement is checked before support: telling
  // an iPhone user "not supported" when the real answer is "add it to your
  // home screen" is the difference between them getting notifications and
  // not.
  if (isIos() && !isStandalone()) return 'needs-install'
  if (!supported) return 'unsupported'
  if (Notification.permission === 'denied') return 'blocked'
  return 'ready'
}
