import { createClient } from '@supabase/supabase-js'

function required(name: string, value: string | undefined): string {
  if (value === undefined || value === '') {
    throw new Error(`Missing ${name}. Copy .env.example to .env.local and fill it in.`)
  }
  return value
}

const url = required('VITE_SUPABASE_URL', import.meta.env.VITE_SUPABASE_URL)
const anonKey = required('VITE_SUPABASE_ANON_KEY', import.meta.env.VITE_SUPABASE_ANON_KEY)

/** The anon key is public by design: it ships inside the bundle on any host,
 *  and RLS plus the token-checked RPCs are what actually constrain it. */
export const supabase = createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true },
  realtime: { params: { eventsPerSecond: 5 } },
})
