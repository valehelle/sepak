import { supabase } from '../lib/supabase'

/** How far the server's clock is ahead of this phone's, in milliseconds.
 *
 *  The round trip is measured and the server's answer is taken to be from
 *  its midpoint, which is accurate to about half the network latency. Good
 *  enough for a countdown: the database, not this number, decides whether a
 *  booking is early. */
export async function measureClockOffset(now: () => number = Date.now): Promise<number> {
  const sent = now()
  const { data, error } = await supabase.rpc('server_now')
  const received = now()
  if (error !== null) throw new Error(`server_now: ${error.message}`)
  if (typeof data !== 'string') throw new Error('server_now: expected a timestamp')
  const server = Date.parse(data)
  if (Number.isNaN(server)) throw new Error(`server_now: unreadable timestamp ${data}`)
  return server - (sent + received) / 2
}
