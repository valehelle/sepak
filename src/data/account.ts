import { getClaimToken } from '../lib/claimToken'
import { supabase } from '../lib/supabase'

export type Profile = { name: string; phone: string }

export class AccountError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AccountError'
  }
}

/** GoTrue's messages are stable English prose; the few a player can cause
 *  are put into Malay, anything else keeps a generic line. */
function friendly(message: string): string {
  if (/invalid login credentials/i.test(message)) return 'Emel atau kata laluan salah.'
  if (/already registered|already been registered/i.test(message)) return 'Emel ini dah ada akaun. Log masuk.'
  if (/password should be at least/i.test(message)) return 'Kata laluan perlu sekurang-kurangnya 6 aksara.'
  if (/rate limit|too many/i.test(message)) return 'Terlalu banyak cubaan. Tunggu sekejap.'
  if (/invalid.*email|email.*invalid/i.test(message)) return 'Emel tak sah.'
  return 'Ada masalah. Cuba lagi.'
}

/** Leaves the page for Google and comes back to `returnTo`. The session
 *  arrives in the URL fragment and supabase-js picks it up on load. */
export async function signInWithGoogle(returnTo: string): Promise<void> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: returnTo },
  })
  if (error !== null) throw new AccountError(friendly(error.message))
}

export async function signInWithEmail(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
  if (error !== null) throw new AccountError(friendly(error.message))
}

/** Email confirmation is off for this project, so a successful sign-up
 *  signs in at once. */
export async function signUpWithEmail(email: string, password: string): Promise<void> {
  const { data, error } = await supabase.auth.signUp({ email: email.trim(), password })
  if (error !== null) throw new AccountError(friendly(error.message))
  if (data.session === null) throw new AccountError('Akaun dicipta tapi belum boleh log masuk. Hubungi admin.')
}

/** Sends a reset link. It lands back on `returnTo`, where the page notices
 *  the recovery sign-in and asks for a new password. */
export async function sendPasswordReset(email: string, returnTo: string): Promise<void> {
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: returnTo })
  if (error !== null) throw new AccountError(friendly(error.message))
}

export async function setNewPassword(password: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password })
  if (error !== null) throw new AccountError(friendly(error.message))
}

export async function signOutPlayer(): Promise<void> {
  const { error } = await supabase.auth.signOut()
  if (error !== null) throw new AccountError(friendly(error.message))
}

function asProfile(row: unknown): Profile | null {
  if (typeof row !== 'object' || row === null) return null
  const r: Record<string, unknown> = Object.fromEntries(Object.entries(row))
  const name = r['name']
  const phone = r['phone']
  return typeof name === 'string' && typeof phone === 'string' ? { name, phone } : null
}

/** The signed-in account's saved name and number, or null if never saved. */
export async function getProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase.from('profiles').select('name, phone').eq('user_id', userId).maybeSingle()
  if (error !== null) throw new AccountError('Gagal memuatkan profil.')
  return data === null ? null : asProfile(data)
}

/** `phone` in stored form (normalisePhone). */
export async function saveProfile(userId: string, profile: Profile): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .upsert({ user_id: userId, name: profile.name.trim(), phone: profile.phone, updated_at: new Date().toISOString() })
  if (error !== null) throw new AccountError('Gagal menyimpan profil.')
}

/** Moves whatever this browser booked before sign-in existed onto the
 *  account. Safe to call on every sign-in; the server ignores a key it has
 *  already moved. Returns how many bookings moved. */
export async function adoptThisBrowser(): Promise<number> {
  const { data, error } = await supabase.rpc('adopt_device', { p_device_token: getClaimToken() })
  if (error !== null) return 0
  return typeof data === 'number' ? data : 0
}

/** Google refuses to sign in inside apps' own browsers. Recognised by the
 *  markers those apps put in the user agent. */
export function isInAppBrowser(userAgent: string = navigator.userAgent): boolean {
  return /FBAN|FBAV|Instagram|Line\/|Telegram|TikTok|Snapchat|Twitter/i.test(userAgent)
}
