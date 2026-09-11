import { supabase } from '../lib/supabase'

export type AdminRole = 'super' | 'admin'

export type Admin = {
  email: string
  role: AdminRole
  addedBy: string | null
  createdAt: string
}

function boom(what: string, message: string): never {
  throw new Error(`${what}: ${message}`)
}

function asRecord(row: unknown, what: string): Record<string, unknown> {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) {
    throw new Error(`${what}: expected an object, got ${typeof row}`)
  }
  return Object.fromEntries(Object.entries(row))
}

function isAdminRole(value: unknown): value is AdminRole {
  return value === 'super' || value === 'admin'
}

/** Rejects rather than casts, matching the guard idiom in src/data/types.ts
 *  (parseSession/parseSlot): an unexpected shape throws instead of silently
 *  becoming `any`. */
export function parseAdmin(row: unknown): Admin {
  const r = asRecord(row, 'admin')

  const email = r['email']
  if (typeof email !== 'string') throw new Error('email: expected a string')

  const role = r['role']
  if (!isAdminRole(role)) throw new Error(`role: unknown value ${String(role)}`)

  const addedBy = r['added_by']
  if (addedBy !== null && typeof addedBy !== 'string') {
    throw new Error('added_by: expected a string or null')
  }

  const createdAt = r['created_at']
  if (typeof createdAt !== 'string') throw new Error('created_at: expected a string')

  return { email, role, addedBy, createdAt }
}

/** Trimmed + lowercased before ever reaching the database -- admins.email is
 *  stored lowercase (see migration 0006_admins.sql), and normalising here
 *  keeps a caller from creating a second, case-different row for the same
 *  person. */
function normaliseEmail(email: string): string {
  return email.trim().toLowerCase()
}

export async function listAdmins(): Promise<Admin[]> {
  const { data, error } = await supabase
    .from('admins')
    .select('email, role, added_by, created_at')
    .order('created_at', { ascending: true })
  if (error !== null) boom('listAdmins', error.message)
  return (data ?? []).map(parseAdmin)
}

export async function addAdmin(email: string, role: AdminRole): Promise<Admin> {
  const { data: sessionData } = await supabase.auth.getSession()
  const addedBy = sessionData.session?.user.email ?? null

  const { data, error } = await supabase
    .from('admins')
    .insert({ email: normaliseEmail(email), role, added_by: addedBy })
    .select('email, role, added_by, created_at')
    .single()
  if (error !== null) boom('addAdmin', error.message)
  return parseAdmin(data)
}

export async function removeAdmin(email: string): Promise<void> {
  const { error } = await supabase.from('admins').delete().eq('email', normaliseEmail(email))
  if (error !== null) boom('removeAdmin', error.message)
}
