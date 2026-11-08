import { getClaimToken } from '../lib/claimToken'
import { supabase } from '../lib/supabase'
import { SlotActionError } from './slots'
import { TELEGRAM_BOT } from './telegram'
import { FALLBACK_ERROR_MESSAGE, RPC_MESSAGES, rpcErrorCode } from './types'

/** Moving a booking to this browser, proved by sharing the booking's phone
 *  number with the bot in Telegram (0025_move_by_phone.sql). */

export type MoveStatus = 'pending' | 'approved' | 'rejected' | 'failed' | 'expired'

const STATUSES: readonly MoveStatus[] = ['pending', 'approved', 'rejected', 'failed', 'expired']

function fail(error: unknown): never {
  const code = rpcErrorCode(error)
  throw new SlotActionError(code === null ? FALLBACK_ERROR_MESSAGE : RPC_MESSAGES[code], code)
}

/** Whether the booking has a phone number to check against. */
export async function moveAvailable(slotId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('move_available', { p_slot_id: slotId })
  if (error !== null) return false
  return data === true
}

/** Opens a request. Returns its id, to poll and to put in the t.me link. */
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

/** Where the player proves the number: the bot, started on this request. */
export function moveLink(requestId: string): string {
  return `https://t.me/${TELEGRAM_BOT}?start=move_${requestId}`
}
