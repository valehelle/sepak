import { getClaimToken } from '../lib/claimToken'
import { supabase } from '../lib/supabase'

/** The bot's username. Public by nature -- it is in every t.me link the app
 *  renders. The bot's token is not here and never reaches the browser. */
export const TELEGRAM_BOT = import.meta.env.VITE_TELEGRAM_BOT ?? ''

export class TelegramError extends Error {
  constructor(message: string, readonly code: string | null) {
    super(message)
    this.name = 'TelegramError'
  }
}

/** Mints the one-time code that a t.me link carries, and returns the link to
 *  open. The code is not the claim token: this URL is going into another app
 *  and may well be pasted somewhere, while the claim token is what
 *  authorises releasing a booking. */
export async function createTelegramLink(): Promise<string> {
  if (TELEGRAM_BOT === '') {
    throw new TelegramError('Telegram belum disediakan.', 'unconfigured')
  }

  const { data, error } = await supabase.rpc('create_telegram_link', {
    p_token: getClaimToken(),
  })
  if (error !== null) {
    const code = error.message.includes('not_in_session') ? 'not_in_session' : null
    throw new TelegramError(
      code === 'not_in_session'
        ? 'Sertai senarai tunggu dulu sebelum sambung Telegram.'
        : 'Gagal menyediakan pautan Telegram.',
      code,
    )
  }
  if (typeof data !== 'string') {
    throw new TelegramError('Gagal menyediakan pautan Telegram.', null)
  }

  return `https://t.me/${TELEGRAM_BOT}?start=${data}`
}

/** Whether this device is already linked to a Telegram chat. Asked of the
 *  database, because nothing about the link is visible to the browser. */
export async function hasTelegramChat(): Promise<boolean> {
  const { data, error } = await supabase.rpc('has_telegram_chat', {
    p_token: getClaimToken(),
  })
  if (error !== null) return false
  return data === true
}
