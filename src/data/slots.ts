import { getClaimToken } from '../lib/claimToken'
import { supabase } from '../lib/supabase'
import { FALLBACK_ERROR_MESSAGE, RPC_MESSAGES, parseSlot, rpcErrorCode, type Slot } from './types'

export class SlotActionError extends Error {
  constructor(message: string, readonly code: string | null) {
    super(message)
    this.name = 'SlotActionError'
  }
}

function fail(error: unknown): never {
  const code = rpcErrorCode(error)
  throw new SlotActionError(code === null ? FALLBACK_ERROR_MESSAGE : RPC_MESSAGES[code], code)
}

export async function claimSlot(slotId: string, playerName: string): Promise<Slot> {
  const { data, error } = await supabase.rpc('claim_slot', {
    p_slot_id: slotId,
    p_name: playerName,
    p_token: getClaimToken(),
  })
  if (error !== null) fail(error)
  return parseSlot(data)
}

export async function releaseSlot(slotId: string): Promise<Slot> {
  const { data, error } = await supabase.rpc('release_slot', {
    p_slot_id: slotId,
    p_token: getClaimToken(),
  })
  if (error !== null) fail(error)
  return parseSlot(data)
}

/** Organiser override for orphaned slots — a player who cleared their browser,
 *  or a joke name. Writes the table directly, which RLS allows only for an
 *  authenticated session. */
export async function adminClearSlot(slotId: string): Promise<void> {
  const { error } = await supabase
    .from('slots')
    .update({ player_name: null, claim_token: null, claimed_at: null })
    .eq('id', slotId)
  if (error !== null) fail(error)
}

/** The slot ids this device owns, proven by presenting the token rather than
 *  by reading it back — `claim_token` is not in anon's column-level select
 *  grant (see migration 0002), so ownership can no longer be determined by
 *  comparing a token read off the row. */
export async function getMySlotIds(sessionId: string): Promise<Set<string>> {
  const { data, error } = await supabase.rpc('my_slot_ids', {
    p_session_id: sessionId,
    p_token: getClaimToken(),
  })
  if (error !== null) fail(error)

  const ids = new Set<string>()
  const rows: unknown[] = data ?? []
  for (const row of rows) {
    if (typeof row === 'string') ids.add(row)
  }
  return ids
}
