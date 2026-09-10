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

function SessionCard({ session, filled }: { session: Session; filled: number }) {
  const fee = formatFee(session.feeMyr)

  return (
    <Link
      to={`/s/${session.id}`}
      className="block space-y-2 rounded-3xl bg-slate-900/70 p-4 active:bg-slate-900"
    >
      <h2 className="font-bold">
        {`Sesi ${String(session.sessionNo).padStart(3, '0')} ${session.title}`}
      </h2>
      <div className="space-y-1 text-sm text-slate-300">
        <p>📅 <span>{formatPlayDate(session.playDate)}</span></p>
        <p>🕒 <span>{formatStartTime(session.startTime)}</span></p>
        <p>🏟️ <span>{session.venue}</span></p>
        {fee !== null && <p>💵 <span>{fee}</span></p>}
      </div>
      <div className="flex gap-2">
        <span className="rounded-full bg-slate-800 px-3 py-1 text-xs font-semibold">
          {`${filled}/${TOTAL_SLOTS} penuh`}
        </span>
        {session.status === 'closed' && (
          <span className="rounded-full bg-red-500/20 px-3 py-1 text-xs font-semibold text-red-300">
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

  if (loading) return <p className="p-6 text-slate-400">Memuatkan…</p>
  if (failed) return <p className="p-6 text-red-400">Gagal memuatkan senarai sesi.</p>

  const today = todayIso()
  const upcoming = sessions.filter((s) => s.playDate >= today).reverse()
  const past = sessions.filter((s) => s.playDate < today)

  return (
    <div className="mx-auto max-w-md space-y-6 p-4">
      <h1 className="text-2xl font-bold">Sepak</h1>

      {sessions.length === 0 && (
        <p className="text-slate-400">Belum ada sesi. Admin boleh buat sesi baru di /admin.</p>
      )}

      {upcoming.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Akan datang</h2>
          {upcoming.map((session) => (
            <SessionCard key={session.id} session={session} filled={counts.get(session.id) ?? 0} />
          ))}
        </section>
      )}

      {past.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Sesi lepas</h2>
          {past.map((session) => (
            <SessionCard key={session.id} session={session} filled={counts.get(session.id) ?? 0} />
          ))}
        </section>
      )}
    </div>
  )
}
