import { getClaimToken } from '../lib/claimToken'
import { supabase } from '../lib/supabase'
import { SlotActionError } from './slots'
import { FALLBACK_ERROR_MESSAGE, RPC_MESSAGES, rpcErrorCode } from './types'

/** Moving a booking to this browser, approved from the Telegram account
 *  linked to the booking (0024_move_booking.sql). */

export type MoveStatus = 'pending' | 'approved' | 'rejected' | 'expired'

const STATUSES: readonly MoveStatus[] = ['pending', 'approved', 'rejected', 'expired']

function fail(error: unknown): never {
  const code = rpcErrorCode(error)
  throw new SlotActionError(code === null ? FALLBACK_ERROR_MESSAGE : RPC_MESSAGES[code], code)
}

/** Whether the booking's browser connected Telegram, which is what makes a
 *  move possible. */
export async function moveAvailable(slotId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('move_available', { p_slot_id: slotId })
  if (error !== null) return false
  return data === true
}

/** Sends the Telegram message. Returns the request's id, to poll. */
export async function requestMove(slotId: string): Promise<string> {
  const { data, error } = await supabase.rpc('request_move', { p_slot_id: slotId, p_token: getClaimToken() })
  if (error !== null) fail(error)
  if (typeof data !== 'string') throw new SlotActionError(FALLBACK_ERROR_MESSAGE, null)
  return data
}

export async function moveStatus(requestId: string): Promise<MoveStatus> {
  const { data, error } = await supabase.rpc('move_request_status', { p_id: requestId, p_token: getClaimToken() })
  if (error !== null) fail(error)
  const status = STATUSES.find((candidate) => candidate === data)
  if (status === undefined) throw new SlotActionError(FALLBACK_ERROR_MESSAGE, null)
  return status
}
