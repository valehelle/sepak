import { useCallback, useEffect, useState } from 'react'
import { ActivityError, listActivity, type ActivityEvent } from '../data/activity'
import { formatEventTime } from '../lib/format'
import { formatOpensAt } from '../lib/opening'
import { formatPhone, whatsappLink } from '../lib/phone'
import { positionLabel } from '../lib/positions'
import { Button } from './Button'

type Feed =
  | { state: 'loading' }
  | { state: 'done'; events: readonly ActivityEvent[] }
  | { state: 'failed'; message: string }

/** Where a line happened, for the lines that have a where. */
function where(event: ActivityEvent): string {
  if (event.team === null || event.position === null) return ''
  return `${event.team} ${positionLabel(event.position)}`
}

/** One line of plain Malay per kind. The subject is always the player the
 *  line is about, so a column of names reads down the page — even for an
 *  admin clear, where the actor and the subject differ. */
export function describeActivity(event: ActivityEvent): string {
  const name = event.playerName
  const spot = where(event)
  switch (event.kind) {
    case 'claim':
      return `${name} ambil ${spot}`
    case 'autofill':
      return `${name} naik dari senarai tunggu → ${spot}`
    case 'release':
      return `${name} lepaskan ${spot}`
    case 'admin_clear':
      return `Admin kosongkan ${spot} (${name})`
    case 'paid':
      return `${name} tanda dah bayar`
    case 'unpaid':
      return `${name} buang tanda bayar`
    case 'waitlist_join':
      return `${name} masuk senarai tunggu`
    case 'waitlist_leave':
      return `${name} keluar senarai tunggu`
    // The subject is the change, and the name is who made it: an admin's
    // email, or "SQL editor" for a change made in the dashboard.
    case 'opens_changed': {
      const from = event.opensFrom === null ? '?' : formatOpensAt(event.opensFrom)
      const to = event.opensTo === null ? '?' : formatOpensAt(event.opensTo)
      return `Masa dibuka ditukar: ${from} → ${to} (${name})`
    }
  }
}

/** The money lines are the ones the organiser is scanning for, so they are
 *  the only ones given a colour. */
const TONE: Record<ActivityEvent['kind'], string | undefined> = {
  claim: undefined,
  autofill: undefined,
  release: 'text-merah-soft',
  admin_clear: 'text-kuning',
  paid: 'text-turf-lit',
  unpaid: 'text-kuning',
  waitlist_join: undefined,
  waitlist_leave: undefined,
  // Worth noticing: this is the line that shows an opening was moved.
  opens_changed: 'text-kuning',
}

export function ActivityFeed() {
  const [feed, setFeed] = useState<Feed>({ state: 'loading' })

  const load = useCallback(() => {
    let cancelled = false
    setFeed({ state: 'loading' })
    listActivity()
      .then((events) => {
        if (!cancelled) setFeed({ state: 'done', events })
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        setFeed({
          state: 'failed',
          message: cause instanceof ActivityError ? cause.message : 'Gagal memuatkan aktiviti.',
        })
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => load(), [load])

  return (
    <section className="rounded-lg border border-white/10 bg-night-2 p-4">
      <div className="mb-3 flex items-center gap-3">
        <h2 className="font-kit text-lg font-semibold tracking-wide text-white">Aktiviti</h2>
        <Button
          variant="secondary"
          size="sm"
          disabled={feed.state === 'loading'}
          onClick={() => void load()}
          className="ml-auto"
        >
          Muat semula
        </Button>
      </div>

      {feed.state === 'loading' && <p className="font-sans text-[13px] text-white/45">Memuatkan…</p>}

      {feed.state === 'failed' && (
        <p className="font-sans text-[13px] text-merah-soft">{feed.message}</p>
      )}

      {feed.state === 'done' && feed.events.length === 0 && (
        <p className="font-sans text-[13px] text-white/45">
          Belum ada apa-apa. Aktiviti muncul di sini bila orang ambil slot, bayar atau lepaskan.
        </p>
      )}

      {feed.state === 'done' && feed.events.length > 0 && (
        <ol className="space-y-2">
          {feed.events.map((event) => (
            <li key={event.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="font-kit text-[12px] tabular-nums text-white/45">
                {formatEventTime(event.createdAt)}
              </span>
              <span className="font-kit text-[12px] text-white/45">
                {`Sesi ${String(event.sessionNo).padStart(3, '0')}`}
              </span>
              <span className={`font-sans text-[14px] ${TONE[event.kind] ?? 'text-white'}`}>
                {describeActivity(event)}
              </span>
              {event.phone !== null && (
                <a
                  href={whatsappLink(event.phone)}
                  target="_blank"
                  rel="noreferrer"
                  className="font-kit text-[12px] text-turf-lit underline decoration-turf-lit/40 underline-offset-2"
                >
                  {formatPhone(event.phone)}
                </a>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
