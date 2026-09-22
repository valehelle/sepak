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

/** `phone` in stored form (see normalisePhone in src/lib/phone.ts); the
 *  database rejects anything else with invalid_phone. */
export async function claimSlot(slotId: string, playerName: string, phone: string): Promise<Slot> {
  const { data, error } = await supabase.rpc('claim_slot', {
    p_slot_id: slotId,
    p_name: playerName,
    p_phone: phone,
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

/** The payment tick. Authorised by the claim token, exactly like
 *  releaseSlot — or by admin, so the organiser can correct a mistaken tick.
 *  Nothing is gated on it; it is the organiser's collection list. */
export async function setSlotPaid(slotId: string, paid: boolean): Promise<Slot> {
  const { data, error } = await supabase.rpc('set_slot_paid', {
    p_slot_id: slotId,
    p_token: getClaimToken(),
    p_paid: paid,
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

/** Changes position without passing through an empty-handed moment. Two
 *  separate actions cannot do this: 0010_one_booking_per_person.sql refuses a
 *  second claim from a device that already holds a slot, so a player would
 *  have to release first and race everyone -- including the waitlist -- for
 *  the position they wanted.
 *
 *  Returns the destination slot. The slot left behind may be taken by a
 *  queued player in the same transaction, which arrives over Realtime. */
export async function moveSlot(fromSlotId: string, toSlotId: string): Promise<Slot> {
  const { data, error } = await supabase.rpc('move_slot', {
    p_from: fromSlotId,
    p_to: toSlotId,
    p_token: getClaimToken(),
  })
  if (error !== null) fail(error)
  return parseSlot(data)
}
