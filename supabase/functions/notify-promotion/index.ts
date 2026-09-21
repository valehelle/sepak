// Sends the "you are off the waitlist" push.
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

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return new Response('method not allowed', { status: 405 })
  }

  const settings = await config()

  // The trigger is the only caller. Without this, the function's URL is a
  // public button anybody could press to spam the group's phones.
  const auth = request.headers.get('Authorization') ?? ''
  if (settings.shared_secret === null || auth !== `Bearer ${settings.shared_secret}`) {
    return new Response('unauthorized', { status: 401 })
  }
  if (settings.vapid_private === null || settings.vapid_public === null) {
    return new Response('vapid keys not in vault', { status: 500 })
  }

  let activityId: unknown = null
  try {
    const payload: unknown = await request.json()
    if (typeof payload === 'object' && payload !== null) {
      activityId = (payload as Record<string, unknown>).activity_id
    }
  } catch {
    return new Response('bad json', { status: 400 })
  }
  if (typeof activityId !== 'number') {
    return new Response('activity_id required', { status: 400 })
  }

  webpush.setVapidDetails(
    settings.vapid_subject ?? 'mailto:admin@example.com',
    settings.vapid_public,
    settings.vapid_private,
  )

  const rows = await rpc('push_targets', { p_activity_id: activityId })
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

  // The response is for the logs; pg_net does not read it.
  return Response.json({ activity_id: activityId, targets: targets.length, sent, dropped })
})
