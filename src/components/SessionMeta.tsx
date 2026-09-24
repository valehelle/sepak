import type { Session } from '../data/types'
import { formatFees, formatPlayDate, formatStartTime } from '../lib/format'

type SessionMetaProps = { session: Session; filled: number; total: number }

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-white/10 py-2 first:border-t-0">
      <span className="font-sans text-[13px] text-white/45">{label}</span>
      <span className="text-right font-sans text-[15px] font-medium text-white">{value}</span>
    </div>
  )
}

export function SessionMeta({ session, filled, total }: SessionMetaProps) {
  const fee = formatFees(session.feeMyr, session.feeGkMyr)
  const pct = total === 0 ? 0 : Math.round((filled / total) * 100)

  return (
    <header>
      {/* The session number reads as a squad number — the most characteristic
          thing about a weekly fixture that has run this many times. */}
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="font-kit text-[56px] font-bold leading-[0.8] tracking-tighter text-white/15"
        >
          {String(session.sessionNo).padStart(3, '0')}
        </span>
        {/* The number is drawn large beside the title but belongs to the
            heading, so it goes in the label rather than a second text node —
            which also keeps the title a single, unambiguous piece of text. */}
        <h1
          aria-label={`Sesi ${String(session.sessionNo).padStart(3, '0')} ${session.title}`}
          className="pt-1 font-kit text-[22px] font-semibold leading-tight"
        >
          {session.title}
        </h1>
      </div>

      <div className="mt-3">
        <Row label="Tarikh" value={formatPlayDate(session.playDate)} />
        <Row label="Masa" value={formatStartTime(session.startTime)} />
        <Row label="Tempat" value={session.venue} />
        {fee !== null && <Row label="Yuran" value={fee} />}
      </div>

      <div className="mt-3 flex items-center gap-3">
        <div
          className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10"
          aria-hidden="true"
        >
          <div className="h-full rounded-full bg-turf-lit" style={{ width: `${pct}%` }} />
        </div>
        <span className="font-kit text-sm font-semibold text-white/70">
          {`${filled}/${total} penuh`}
        </span>
        {session.status === 'closed' && (
          <span className="rounded-sm bg-merah px-2 py-0.5 font-kit text-xs font-semibold text-white">
            Sesi ditutup
          </span>
        )}
      </div>
    </header>
  )
}
