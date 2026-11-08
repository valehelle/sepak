// Sends the "you are off the waitlist" push, and the Telegram message asking
// a player to approve moving their booking to another browser.
//
// This exists because Web Push needs an ECDSA signature over a JWT and an
// AES-GCM encrypted payload, and Postgres can do neither. It is deliberately
// the dumbest part of the feature: it decides nothing. Who to notify and
// what the notification says both come from sepak.push_targets(), so those
// decisions sit in a migration with a SQL test around them rather than in a
// function pasted into a dashboard.
//
// Called by the trigger in 0013_push.sql with {"activity_id": <id>} and a
// bearer token. The activity id is all it is given -- the claim token, the
// phone numbers and the endpoints stay inside the database until this
// function asks for them as service_role.
//
// It also serves Telegram's webhook (0014_telegram.sql), which is a second
// job in one file on purpose: it means one function to deploy and one place
// to read, and both halves need the same Vault-backed configuration.
import webpush from 'npm:web-push@3.6.7'

// These two are injected by Supabase; nothing here has to be configured by
// hand. Every other value -- the shared secret and the VAPID pair -- is read
// from Vault through sepak.push_config(), so installing this function means
// pasting this file and nothing else.
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

type Config = {
  shared_secret: string | null
  vapid_public: string | null
  vapid_private: string | null
  vapid_subject: string | null
  telegram_token: string | null
  telegram_secret: string | null
}

// Cached for the lifetime of a warm instance: a promotion is rare, but two
// in one evening should not both pay for the lookup.
let cachedConfig: Config | null = null

type Target = {
  endpoint: string
  p256dh: string
  auth: string
  title: string
  body: string
  url: string
}

type TelegramTarget = {
  chat_id: number
  title: string
  body: string
  url: string
}

/** Every database call goes through an RPC in the `sepak` schema as
 *  service_role. Note the profile headers: this app does not live in
 *  `public`. */
async function rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Profile': 'sepak',
      'Accept-Profile': 'sepak',
    },
    body: JSON.stringify(args),
  })
  if (!response.ok) {
    throw new Error(`${name} failed: ${response.status} ${await response.text()}`)
  }
  const text = await response.text()
  return text === '' ? null : JSON.parse(text)
}

function isConfig(value: unknown): value is Config {
  if (typeof value !== 'object' || value === null) return false
  const row = value as Record<string, unknown>
  return 'shared_secret' in row && 'vapid_private' in row
}

async function config(): Promise<Config> {
  if (cachedConfig !== null) return cachedConfig
  const rows = await rpc('push_config', {})
  const first = Array.isArray(rows) ? rows[0] : rows
  if (!isConfig(first)) throw new Error('push_config returned nothing usable')
  cachedConfig = first
  return first
}

function isTelegramTarget(value: unknown): value is TelegramTarget {
  if (typeof value !== 'object' || value === null) return false
  const row = value as Record<string, unknown>
  return typeof row.chat_id === 'number' && typeof row.title === 'string' && typeof row.body === 'string'
}

/** One call to the Bot API. Returns the HTTP status so the caller can tell a
 *  chat that is gone (403) from a transient failure. */
async function telegram(token: string, method: string, body: Record<string, unknown>): Promise<number> {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) console.error(`telegram ${method}`, response.status, await response.text())
  return response.status
}

function isTarget(value: unknown): value is Target {
  if (typeof value !== 'object' || value === null) return false
  const row = value as Record<string, unknown>
  return (
    typeof row.endpoint === 'string' &&
    typeof row.p256dh === 'string' &&
    typeof row.auth === 'string' &&
    typeof row.title === 'string' &&
    typeof row.body === 'string' &&
    typeof row.url === 'string'
  )
}

/** Moving a booking to another browser (0024_move_booking.sql): the message
 *  to the Telegram account linked to the booking, with the two buttons. The
 *  callback data carries only the request id; decide_move checks the answer
 *  came from the chat the request was sent to. */
const MOVE_PREFIX = 'move:'

async function sendMoveRequest(requestId: string, token: string): Promise<Response> {
  const rows = await rpc('move_request_message', { p_id: requestId })
  const row = Array.isArray(rows) ? rows[0] : null
  if (typeof row !== 'object' || row === null) return Response.json({ move_request_id: requestId, sent: false })
  const { chat_id: chatId, body } = row as Record<string, unknown>
  if (typeof chatId !== 'number' || typeof body !== 'string') {
    return Response.json({ move_request_id: requestId, sent: false })
  }

  const status = await telegram(token, 'sendMessage', {
    chat_id: chatId,
    text: body,
    reply_markup: {
      inline_keyboard: [[
        { text: 'Ya, pindahkan', callback_data: `${MOVE_PREFIX}yes:${requestId}` },
        { text: 'Bukan saya', callback_data: `${MOVE_PREFIX}no:${requestId}` },
      ]],
    },
  })
  if (status === 403) await rpc('drop_telegram_chat', { p_chat_id: chatId })
  return Response.json({ move_request_id: requestId, sent: status === 200 })
}

const MOVE_OUTCOMES: Record<string, string> = {
  approved: 'Siap. Slot anda dah dipindahkan ke browser tu. Buka halaman sesi di situ untuk ubah atau tanda bayar.',
  rejected: 'Baik. Slot kekal di browser asal.',
  expired: 'Permintaan ni dah tamat tempoh. Tekan "Ambil balik" di halaman sesi sekali lagi kalau perlu.',
  stale: 'Slot ni dah bertukar sejak permintaan dibuat, jadi tiada apa dipindahkan.',
  already_in_slot: 'Browser tu dah ada tempat lain dalam sesi ni, jadi slot tak boleh dipindahkan ke situ.',
  not_found: 'Permintaan ni tak sah lagi.',
}

async function handleMoveAnswer(callback: Record<string, unknown>, token: string): Promise<Response> {
  const callbackId = callback.id
  const data = typeof callback.data === 'string' ? callback.data : ''
  const message = typeof callback.message === 'object' && callback.message !== null
    ? (callback.message as Record<string, unknown>)
    : null
  const chat = message !== null && typeof message.chat === 'object' && message.chat !== null
    ? (message.chat as Record<string, unknown>)
    : null
  const chatId = chat?.id
  const messageId = message?.message_id

  const match = /^move:(yes|no):([0-9a-f-]{36})$/.exec(data)
  if (match === null || typeof chatId !== 'number') {
    if (typeof callbackId === 'string') await telegram(token, 'answerCallbackQuery', { callback_query_id: callbackId })
    return Response.json({ ok: true })
  }

  const outcome = await rpc('decide_move', { p_id: match[2], p_chat_id: chatId, p_approve: match[1] === 'yes' })
  const text = MOVE_OUTCOMES[typeof outcome === 'string' ? outcome : 'not_found'] ?? MOVE_OUTCOMES.not_found

  if (typeof callbackId === 'string') await telegram(token, 'answerCallbackQuery', { callback_query_id: callbackId })
  // Replacing the message removes the buttons, so it cannot be answered twice.
  if (typeof messageId === 'number') {
    await telegram(token, 'editMessageText', { chat_id: chatId, message_id: messageId, text })
  } else {
    await telegram(token, 'sendMessage', { chat_id: chatId, text })
  }
  return Response.json({ ok: true })
}

/** Telegram's side of the opt-in: somebody pressed Start on the bot, having
 *  arrived through a t.me link carrying a one-time code. Telegram calls this
 *  with the secret token it was given at registration, which is what makes
 *  the endpoint safe to leave open. */
async function handleTelegramUpdate(update: unknown, settings: Config): Promise<Response> {
  const token = settings.telegram_token
  if (token === null) return new Response('telegram not configured', { status: 500 })

  const callback = typeof update === 'object' && update !== null
    ? (update as Record<string, unknown>).callback_query
    : null
  if (typeof callback === 'object' && callback !== null) {
    return handleMoveAnswer(callback as Record<string, unknown>, token)
  }

  const message = typeof update === 'object' && update !== null
    ? (update as Record<string, unknown>).message
    : null
  if (typeof message !== 'object' || message === null) return Response.json({ ok: true })

  const fields = message as Record<string, unknown>
  const chat = typeof fields.chat === 'object' && fields.chat !== null
    ? (fields.chat as Record<string, unknown>)
    : null
  const chatId = chat === null ? null : chat.id
  const text = typeof fields.text === 'string' ? fields.text.trim() : ''
  if (typeof chatId !== 'number') return Response.json({ ok: true })

  if (text === '/stop') {
    await rpc('drop_telegram_chat', { p_chat_id: chatId })
    await telegram(token, 'sendMessage', {
      chat_id: chatId,
      text: 'Dah berhenti. Anda tak akan dapat notifikasi dari kami lagi.',
    })
    return Response.json({ ok: true })
  }

  const code = text.startsWith('/start') ? text.slice('/start'.length).trim() : ''
  if (code === '') {
    await telegram(token, 'sendMessage', {
      chat_id: chatId,
      text: 'Buka pautan "Guna Telegram" dalam halaman sesi untuk sambung akaun ni.',
    })
    return Response.json({ ok: true })
  }

  const linked = await rpc('claim_telegram_link', { p_code: code, p_chat_id: chatId })
  await telegram(token, 'sendMessage', {
    chat_id: chatId,
    text: linked === true
      ? 'Siap! Kami akan beritahu di sini sebaik sahaja anda naik dari senarai tunggu.'
      : 'Pautan ni dah tamat tempoh. Buka halaman sesi dan tekan "Guna Telegram" sekali lagi.',
  })
  return Response.json({ ok: true })
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return new Response('method not allowed', { status: 405 })
  }

  const settings = await config()

  // Telegram identifies itself with the secret token given at registration.
  // Checked before the shared-secret gate below, because Telegram does not
  // send an Authorization header.
  const telegramSecret = request.headers.get('X-Telegram-Bot-Api-Secret-Token')
  if (telegramSecret !== null) {
    if (settings.telegram_secret === null || telegramSecret !== settings.telegram_secret) {
      return new Response('unauthorized', { status: 401 })
    }
    let update: unknown = null
    try {
      update = await request.json()
    } catch {
      return new Response('bad json', { status: 400 })
    }
    return handleTelegramUpdate(update, settings)
  }

  // The trigger is the only caller. Without this, the function's URL is a
  // public button anybody could press to spam the group's phones.
  const auth = request.headers.get('Authorization') ?? ''
  if (settings.shared_secret === null || auth !== `Bearer ${settings.shared_secret}`) {
    return new Response('unauthorized', { status: 401 })
  }

  let activityId: unknown = null
  let moveRequestId: unknown = null
  try {
    const payload: unknown = await request.json()
    if (typeof payload === 'object' && payload !== null) {
      activityId = (payload as Record<string, unknown>).activity_id
      moveRequestId = (payload as Record<string, unknown>).move_request_id
    }
  } catch {
    return new Response('bad json', { status: 400 })
  }
  if (typeof moveRequestId === 'string') {
    if (settings.telegram_token === null) return new Response('telegram not configured', { status: 500 })
    return sendMoveRequest(moveRequestId, settings.telegram_token)
  }
  if (typeof activityId !== 'number') {
    return new Response('activity_id required', { status: 400 })
  }

  // The two channels are independent: a setup with only Telegram configured
  // (no VAPID pair in Vault) must still deliver, and vice versa. Neither
  // missing key is an error, it just means that channel is not in use.
  const pushConfigured = settings.vapid_public !== null && settings.vapid_private !== null
  if (pushConfigured) {
    webpush.setVapidDetails(
      settings.vapid_subject ?? 'mailto:admin@example.com',
      settings.vapid_public ?? '',
      settings.vapid_private ?? '',
    )
  }

  const rows = pushConfigured ? await rpc('push_targets', { p_activity_id: activityId }) : []
  const targets = Array.isArray(rows) ? rows.filter(isTarget) : []

  let sent = 0
  let dropped = 0
  for (const target of targets) {
    try {
      await webpush.sendNotification(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        JSON.stringify({ title: target.title, body: target.body, url: target.url }),
        { TTL: 60 * 60 * 12 },
      )
      sent += 1
      await rpc('mark_push_sent', { p_endpoint: target.endpoint })
    } catch (cause: unknown) {
      // 404 or 410 means the browser is gone for good -- uninstalled, or
      // site data cleared. Anything else (a 5xx from the push service, a
      // timeout) is left alone: the row is still good and the next promotion
      // can try again.
      const status = typeof cause === 'object' && cause !== null
        ? (cause as Record<string, unknown>).statusCode
        : undefined
      if (status === 404 || status === 410) {
        await rpc('drop_push_subscription', { p_endpoint: target.endpoint })
        dropped += 1
      } else {
        console.error('push failed', status ?? cause)
      }
    }
  }

  // Telegram, the channel that works on every phone: no install, no
  // permission dialog, and free. Failures here must not affect the push
  // result above -- they are separate deliveries of the same news.
  let telegramSent = 0
  let telegramDropped = 0
  if (settings.telegram_token !== null) {
    const chatRows = await rpc('telegram_targets', { p_activity_id: activityId })
    const chats = Array.isArray(chatRows) ? chatRows.filter(isTelegramTarget) : []
    for (const chat of chats) {
      const status = await telegram(settings.telegram_token, 'sendMessage', {
        chat_id: chat.chat_id,
        // Markdown is deliberately avoided: a player's name is user input,
        // and escaping it correctly is more risk than the bold is worth.
        text: `${chat.title}\n${chat.body}\n${chat.url}`,
        disable_web_page_preview: false,
      })
      if (status === 200) {
        telegramSent += 1
        await rpc('mark_telegram_sent', { p_chat_id: chat.chat_id })
      } else if (status === 403 || status === 400) {
        // Blocked the bot, or deleted the chat: stop trying forever.
        await rpc('drop_telegram_chat', { p_chat_id: chat.chat_id })
        telegramDropped += 1
      }
    }
  }

  // The response is for the logs; pg_net does not read it.
  return Response.json({
    activity_id: activityId,
    push: { targets: targets.length, sent, dropped },
    telegram: { sent: telegramSent, dropped: telegramDropped },
  })
})
