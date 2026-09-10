import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { AdminRole } from './admins'

export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error !== null) throw new Error(error.message)
}

export async function signUp(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signUp({ email, password })
  if (error !== null) throw new Error(error.message)
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut()
  if (error !== null) throw new Error(error.message)
}

function isAdminRole(value: unknown): value is AdminRole {
  return value === 'super' || value === 'admin'
}

/** The caller's own row in `admins`, or null if signed out or signed in but
 *  not on the allowlist. Looked up by primary key rather than through
 *  listAdmins() so a plain admin (who can select every row, per the
 *  admins_select policy) never fetches more than their own. */
async function fetchOwnRole(email: string): Promise<AdminRole | null> {
  const { data, error } = await supabase.from('admins').select('role').eq('email', email.toLowerCase()).maybeSingle()
  if (error !== null || data === null) return null
  const role: unknown = Object.fromEntries(Object.entries(data))['role']
  return isAdminRole(role) ? role : null
}

/** Sign-ups are now open (supabase/config.toml, [auth] enable_signup): the
 *  allowlist in public.admins, not account existence, is what authorises
 *  anything. `role` is therefore fetched separately from the session -- it
 *  is null both when signed out and when signed in but not on the
 *  allowlist, and callers that need to tell those two apart also check
 *  `loading`/`email`. */
export function useAuthUser(): { email: string | null; role: AdminRole | null; loading: boolean } {
  const [email, setEmail] = useState<string | null>(null)
  const [role, setRole] = useState<AdminRole | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function applySession(sessionEmail: string | null) {
      if (cancelled) return
      setEmail(sessionEmail)
      if (sessionEmail === null) {
        setRole(null)
        return
      }
      const fetchedRole = await fetchOwnRole(sessionEmail)
      if (!cancelled) setRole(fetchedRole)
    }

    supabase.auth.getSession().then(({ data }) => {
      void applySession(data.session?.user.email ?? null).finally(() => {
        if (!cancelled) setLoading(false)
      })
    })

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      void applySession(session?.user.email ?? null)
    })

    return () => {
      cancelled = true
      subscription.subscription.unsubscribe()
    }
  }, [])

  return { email, role, loading }
}
