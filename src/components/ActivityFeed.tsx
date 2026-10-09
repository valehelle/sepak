import { useCallback, useEffect, useState } from 'react'
import { ActivityError, listSessionActivity, type ActivityEvent } from '../data/activity'
import type { Slot } from '../data/types'
import { formatEventTime } from '../lib/format'
import { formatPhone, whatsappLink } from '../lib/phone'
import { positionLabel } from '../lib/positions'
import { Button } from './Button'

/** The feed's tabs. Bayar comes first after Semua: chasing payment is what
 *  the organiser opens this for most. A move is logged as a release and a
 *  claim (0015_move_slot.sql), so it shows under Keluar and Tukar both. */
const TABS = [
  { key: 'all', label: 'Semua', kinds: null },
  { key: 'paid', label: 'Bayar', kinds: ['paid', 'unpaid'] },
  { key: 'out', label: 'Keluar', kinds: ['release', 'admin_clear'] },
  { key: 'change', label: 'Tukar', kinds: ['claim', 'autofill', 'waitlist_join', 'waitlist_leave'] },
] as const satisfies readonly { key: string; label: string; kinds: readonly ActivityEvent['kind'][] | null }[]

type TabKey = (typeof TABS)[number]['key']

function inTab(event: ActivityEvent, tab: (typeof TABS)[number]): boolean {
  return tab.kinds === null || tab.kinds.some((kind) => kind === event.kind)
}

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
}

/** One session's history, shown to admins on that session's page. Per
 *  session rather than one feed for everything: the combined feed mixed
 *  this week's game with last week's. */
type ActivityFeedProps = {
  sessionId: string
  /** The session's slots as the page has them, to find each tick's receipt. */
  slots: readonly Slot[]
  onViewReceipt: (path: string) => void
}

/** The receipt behind a "dah bayar" line, if that tick still stands: the
 *  newest paid line for a slot, while the same player holds it and it is
 *  still ticked. Older lines -- a tick later taken back, or a previous
 *  occupant's -- get nothing, rather than someone else's receipt. */
function receiptFor(
  event: ActivityEvent,
  slots: readonly Slot[],
  newestPaid: ReadonlySet<number>,
): { path: string | null } | null {
  if (event.kind !== 'paid' || !newestPaid.has(event.id)) return null
  const slot = slots.find(
    (candidate) =>
      candidate.team === event.team && candidate.position === event.position && candidate.playerName === event.playerName,
  )
  if (slot === undefined || !slot.paid) return null
  return { path: slot.receiptPath }
}

export function ActivityFeed({ sessionId, slots, onViewReceipt }: ActivityFeedProps) {
  const [feed, setFeed] = useState<Feed>({ state: 'loading' })
  const [tabKey, setTabKey] = useState<TabKey>('all')
  const tab = TABS.find((candidate) => candidate.key === tabKey) ?? TABS[0]
  const shown = feed.state === 'done' ? feed.events.filter((event) => inTab(event, tab)) : []
  // The feed is newest first, so the first paid line seen per position is
  // the one that may still have a receipt behind it.
  const newestPaid = new Set<number>()
  if (feed.state === 'done') {
    const seen = new Set<string>()
    for (const event of feed.events) {
      if (event.kind !== 'paid') continue
      const where = `${event.team ?? ''}:${event.position ?? ''}`
      if (seen.has(where)) continue
      seen.add(where)
      newestPaid.add(event.id)
    }
  }

  const load = useCallback(() => {
    let cancelled = false
    setFeed({ state: 'loading' })
    listSessionActivity(sessionId)
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
  }, [sessionId])

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

      {feed.state === 'done' && feed.events.length > 0 && (
        <div role="tablist" aria-label="Jenis aktiviti" className="mb-3 flex gap-1.5 overflow-x-auto">
          {TABS.map((candidate) => {
            const count = feed.events.filter((event) => inTab(event, candidate)).length
            const active = candidate.key === tabKey
            return (
              <button
                key={candidate.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTabKey(candidate.key)}
                className={[
                  'shrink-0 rounded-full px-3 py-1 font-kit text-[13px] font-semibold transition',
                  active ? 'bg-turf-lit text-white' : 'bg-white/5 text-white/60',
                ].join(' ')}
              >
                {`${candidate.label} (${count})`}
              </button>
            )
          })}
        </div>
      )}

      {feed.state === 'loading' && <p className="font-sans text-[13px] text-white/45">Memuatkan…</p>}

      {feed.state === 'failed' && (
        <p className="font-sans text-[13px] text-merah-soft">{feed.message}</p>
      )}

      {feed.state === 'done' && feed.events.length === 0 && (
        <p className="font-sans text-[13px] text-white/45">
          Belum ada apa-apa. Aktiviti muncul di sini bila orang ambil slot, bayar atau lepaskan.
        </p>
      )}

      {feed.state === 'done' && feed.events.length > 0 && shown.length === 0 && (
        <p className="font-sans text-[13px] text-white/45">Tiada aktiviti jenis ini lagi.</p>
      )}

      {shown.length > 0 && (
        <ol className="space-y-2">
          {shown.map((event) => (
            <li key={event.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="font-kit text-[12px] tabular-nums text-white/45">
                {formatEventTime(event.createdAt)}
              </span>
              <span className={`font-sans text-[14px] ${TONE[event.kind] ?? 'text-white'}`}>
                {describeActivity(event)}
              </span>
              {(() => {
                const receipt = receiptFor(event, slots, newestPaid)
                if (receipt === null) return null
                return receipt.path === null ? (
                  <span className="font-kit text-[12px] text-kuning">tiada resit</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      if (receipt.path !== null) onViewReceipt(receipt.path)
                    }}
                    className="font-kit text-[12px] text-turf-lit underline decoration-turf-lit/40 underline-offset-2"
                  >
                    🧾 Lihat resit
                  </button>
                )
              })()}
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
