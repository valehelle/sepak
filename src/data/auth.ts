import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { AdminRole } from './admins'

export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error !== null) throw new Error(error.message)
}

/** `signedIn` is whether the project handed back a session. It does with
 *  "Confirm email" off (the configuration this app requires -- see
 *  supabase/config.toml, [auth].enable_signup); with it on, sign-up creates
 *  an account nobody can use, since the built-in mailer only delivers to the
 *  Supabase team. The caller must not announce success on `false`. */
export async function signUp(email: string, password: string): Promise<{ signedIn: boolean }> {
  const { data, error } = await supabase.auth.signUp({ email, password })
  if (error !== null) throw new Error(error.message)
  return { signedIn: data.session !== null }
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut()
  if (error !== null) throw new Error(error.message)
}

function isAdminRole(value: unknown): value is AdminRole {
  return value === 'super' || value === 'admin'
}

/** The caller's own row in `admins`, or null if signed out or signed in but
 *  not an admin. Looked up by account, which is what admin rights are bound
 *  to (0019_accounts.sql) -- not by email, which anyone can register. */
async function fetchOwnRole(userId: string): Promise<AdminRole | null> {
  const { data, error } = await supabase.from('admins').select('role').eq('user_id', userId).maybeSingle()
  if (error !== null || data === null) return null
  const role: unknown = Object.fromEntries(Object.entries(data))['role']
  return isAdminRole(role) ? role : null
}

/** Sign-ups are now open (supabase/config.toml, [auth] enable_signup): the
 *  allowlist in sepak.admins, not account existence, is what authorises
 *  anything. `role` is therefore fetched separately from the session -- it
 *  is null both when signed out and when signed in but not on the
 *  allowlist, and callers that need to tell those two apart also check
 *  `loading`/`email`. */
export type AuthUser = {
  /** The signed-in account, player or admin. Null when signed out. */
  userId: string | null
  email: string | null
  role: AdminRole | null
  loading: boolean
}

export function useAuthUser(): AuthUser {
  const [userId, setUserId] = useState<string | null>(null)
  const [email, setEmail] = useState<string | null>(null)
  const [role, setRole] = useState<AdminRole | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function applySession(sessionUserId: string | null, sessionEmail: string | null) {
      if (cancelled) return
      setUserId(sessionUserId)
      setEmail(sessionEmail)
      if (sessionUserId === null) {
        setRole(null)
        return
      }
      const fetchedRole = await fetchOwnRole(sessionUserId)
      if (!cancelled) setRole(fetchedRole)
    }

    supabase.auth.getSession().then(({ data }) => {
      void applySession(data.session?.user.id ?? null, data.session?.user.email ?? null).finally(() => {
        if (!cancelled) setLoading(false)
      })
    })

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      void applySession(session?.user.id ?? null, session?.user.email ?? null)
    })

    return () => {
      cancelled = true
      subscription.subscription.unsubscribe()
    }
  }, [])

  return { userId, email, role, loading }
}
