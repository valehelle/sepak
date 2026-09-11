import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { fillCounts, listSessions } from '../data/sessions'
import type { Session } from '../data/types'
import { formatFee, formatPlayDate, formatStartTime } from '../lib/format'

const TOTAL_SLOTS = 33

function todayIso(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-white/10 py-1.5 first:border-t-0">
      <span className="font-sans text-[12px] text-white/45">{label}</span>
      <span className="text-right font-sans text-[13px] font-medium text-white">{value}</span>
    </div>
  )
}

function SessionCard({ session, filled, past = false }: { session: Session; filled: number; past?: boolean }) {
  const fee = formatFee(session.feeMyr)
  const padded = String(session.sessionNo).padStart(3, '0')
  const pct = Math.round((filled / TOTAL_SLOTS) * 100)

  return (
    <Link
      to={`/s/${session.id}`}
      className={[
        'block space-y-2 rounded-lg border border-white/10 bg-night-2 p-4 transition hover:border-white/25',
        past ? 'opacity-60' : '',
      ].join(' ')}
    >
      {/* Kept as one flowing text node -- testing-library's getByText only
          matches an element's own text, not text spread across children, so
          the session number can't be dimmed in a nested span without
          breaking the exact-text assertions in SessionList.test.tsx. */}
      <h2 className="font-kit text-lg font-semibold text-white">
        {`Sesi ${padded} ${session.title}`}
      </h2>

      <div>
        <Row label="Tarikh" value={formatPlayDate(session.playDate)} />
        <Row label="Masa" value={formatStartTime(session.startTime)} />
        <Row label="Tempat" value={session.venue} />
        {fee !== null && <Row label="Yuran" value={fee} />}
      </div>

      <div className="flex items-center gap-3 pt-1">
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
          <div className="h-full rounded-full bg-turf-lit" style={{ width: `${pct}%` }} />
        </div>
        <span className="font-kit text-xs font-semibold text-white/70">{`${filled}/${TOTAL_SLOTS} penuh`}</span>
        {session.status === 'closed' && (
          <span className="rounded-sm bg-merah/20 px-2 py-0.5 font-kit text-xs font-semibold text-merah-soft">
            Ditutup
          </span>
        )}
      </div>
    </Link>
  )
}

export default function SessionList() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [counts, setCounts] = useState<Map<string, number>>(new Map())
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false

    listSessions()
      .then(async (rows) => {
        if (cancelled) return
        setSessions(rows)
        setCounts(await fillCounts(rows.map((row) => row.id)))
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  if (loading) return <p className="p-6 font-sans text-white/45">Memuatkan…</p>
  if (failed) return <p className="p-6 font-sans text-merah-soft">Gagal memuatkan senarai sesi.</p>

  const today = todayIso()
  const upcoming = sessions.filter((s) => s.playDate >= today).reverse()
  const past = sessions.filter((s) => s.playDate < today)

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-8">
      <h1 className="font-kit text-3xl font-semibold text-white">Sepak</h1>

      {sessions.length === 0 && (
        <p className="font-sans text-[15px] text-white/45">Belum ada sesi. Admin boleh buat sesi baru di /admin.</p>
      )}

      {upcoming.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-kit text-lg text-white/70">Akan datang</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {upcoming.map((session) => (
              <SessionCard key={session.id} session={session} filled={counts.get(session.id) ?? 0} />
            ))}
          </div>
        </section>
      )}

      {past.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-kit text-lg text-white/70">Sesi lepas</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {past.map((session) => (
              <SessionCard key={session.id} session={session} filled={counts.get(session.id) ?? 0} past />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
