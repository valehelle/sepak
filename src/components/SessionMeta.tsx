import type { Session } from '../data/types'
import { formatFee, formatPlayDate, formatStartTime } from '../lib/format'

type SessionMetaProps = { session: Session; filled: number; total: number }

function Row({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2 text-sm">
      <span aria-hidden="true">{icon}</span>
      <span className="text-slate-400">{label}</span>
      <span className="font-medium text-slate-100">{value}</span>
    </div>
  )
}

export function SessionMeta({ session, filled, total }: SessionMetaProps) {
  const fee = formatFee(session.feeMyr)

  return (
    <header className="space-y-3 rounded-3xl bg-slate-900/70 p-4">
      <h1 className="text-lg font-bold">
        {`Sesi ${String(session.sessionNo).padStart(3, '0')} ${session.title}`}
      </h1>

      <div className="space-y-1.5">
        <Row icon="📅" label="Tarikh" value={formatPlayDate(session.playDate)} />
        <Row icon="🕒" label="Masa" value={formatStartTime(session.startTime)} />
        <Row icon="🏟️" label="Tempat" value={session.venue} />
        {fee !== null && <Row icon="💵" label="Yuran" value={fee} />}
      </div>

      <div className="flex items-center gap-2">
        <span className="rounded-full bg-slate-800 px-3 py-1 text-xs font-semibold text-slate-200">
          {`${filled}/${total} penuh`}
        </span>
        {session.status === 'closed' && (
          <span className="rounded-full bg-red-500/20 px-3 py-1 text-xs font-semibold text-red-300">
            Sesi ditutup
          </span>
        )}
      </div>
    </header>
  )
}
