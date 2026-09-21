import { getClaimToken } from '../lib/claimToken'
import { supabase } from '../lib/supabase'

/** The public half of the VAPID pair. It ships in the bundle on purpose --
 *  it is the key the browser subscribes with, and it authorises nothing on
 *  its own. The private half lives only in the Edge Function's secrets. */
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY ?? ''

export class PushError extends Error {
  constructor(message: string, readonly code: string | null) {
    super(message)
    this.name = 'PushError'
  }
}

/** The subscribe call wants the key as bytes, and hands it to us as
 *  base64url. Neither padding nor the URL-safe alphabet is accepted by
 *  atob, so both are undone first. */
function keyToBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = base64url.padEnd(base64url.length + ((4 - (base64url.length % 4)) % 4), '=')
  const binary = atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
  // Backed by an explicit ArrayBuffer: `new Uint8Array(length)` is typed over
  // ArrayBufferLike, which includes SharedArrayBuffer and so is not a
  // BufferSource as far as pushManager.subscribe is concerned.
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** ...and the reverse, because the two keys on a subscription come back as
 *  ArrayBuffers and the database stores them as base64url text. */
function bytesToKey(buffer: ArrayBuffer | null): string {
  if (buffer === null) throw new PushError('Langganan notifikasi tak lengkap.', 'incomplete')
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Registered at the app's own base so the worker's scope covers the whole
 *  app and no more -- on GitHub Pages the site shares an origin with every
 *  other project page on the account. */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration> {
  const base = import.meta.env.BASE_URL
  return navigator.serviceWorker.register(`${base}sw.js`, { scope: base })
}

/** Asks permission, subscribes, and stores the endpoint against this
 *  device's claim token. Throws PushError with a code the UI can explain:
 *  `blocked` when permission was refused, `unconfigured` when the build has
 *  no VAPID key, `not_in_session` when the device has no booking to attach
 *  the subscription to. */
export async function subscribeToPush(): Promise<void> {
  if (VAPID_PUBLIC_KEY === '') {
    throw new PushError('Notifikasi belum disediakan.', 'unconfigured')
  }

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new PushError('Anda tak izinkan notifikasi.', 'blocked')
  }

  const registration = await registerServiceWorker()
  // A browser that already has a subscription returns the same one, which is
  // what makes calling this twice harmless.
  const existing = await registration.pushManager.getSubscription()
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      // Required, and true is the only honest value: every push we send
      // shows a notification.
      userVisibleOnly: true,
      applicationServerKey: keyToBytes(VAPID_PUBLIC_KEY),
    }))

  const { error } = await supabase.rpc('save_push_subscription', {
    p_token: getClaimToken(),
    p_endpoint: subscription.endpoint,
    p_p256dh: bytesToKey(subscription.getKey('p256dh')),
    p_auth: bytesToKey(subscription.getKey('auth')),
    p_user_agent: navigator.userAgent,
  })
  if (error !== null) {
    const code = error.message.includes('not_in_session') ? 'not_in_session' : null
    throw new PushError(
      code === 'not_in_session'
        ? 'Sertai senarai tunggu dulu sebelum hidupkan notifikasi.'
        : 'Gagal menyimpan langganan notifikasi.',
      code,
    )
  }
}

/** Whether this device has a live subscription on record. Asked of the
 *  database rather than the browser, because the browser's own answer says
 *  nothing about whether we ever managed to store it. */
export async function hasPushSubscription(): Promise<boolean> {
  const { data, error } = await supabase.rpc('has_push_subscription', {
    p_token: getClaimToken(),
  })
  if (error !== null) return false
  return data === true
}

/** Turns notifications off for this device: the browser subscription goes,
 *  and so does the row. */
export async function unsubscribeFromPush(): Promise<void> {
  const registration = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL)
  const subscription = await registration?.pushManager.getSubscription()
  if (subscription !== undefined && subscription !== null) {
    await supabase.rpc('delete_push_subscription', {
      p_token: getClaimToken(),
      p_endpoint: subscription.endpoint,
    })
    await subscription.unsubscribe()
  }
}
