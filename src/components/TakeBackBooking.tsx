import { useEffect, useRef, useState } from 'react'
import { moveAvailable, moveStatus, requestMove, type MoveStatus } from '../data/move'
import { SlotActionError } from '../data/slots'
import { Button } from './Button'

/** How often the page asks whether the player has answered in Telegram. */
const POLL_MS = 3000

type Stage =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'waiting'; requestId: string }
  | { kind: 'done'; status: Exclude<MoveStatus, 'pending' | 'approved'> }
  | { kind: 'failed'; message: string }

const DONE_TEXT: Record<Exclude<MoveStatus, 'pending' | 'approved'>, string> = {
  rejected: 'Permintaan ditolak di Telegram. Slot kekal di browser asal.',
  expired: 'Tiada jawapan dalam 10 minit. Tekan sekali lagi kalau perlu.',
}

type TakeBackBookingProps = {
  slotId: string
  /** The booking is now this browser's. */
  onMoved: () => void
}

/** On a booked slot this browser does not hold: lets the player move their
 *  own booking here, approved from the Telegram account linked to it. A
 *  booking belongs to the browser it was made in, so someone who booked
 *  inside WhatsApp and came back in Safari lands here. Shown only when the
 *  booking's browser connected Telegram. */
export function TakeBackBooking({ slotId, onMoved }: TakeBackBookingProps) {
  const [available, setAvailable] = useState(false)
  const [stage, setStage] = useState<Stage>({ kind: 'idle' })

  useEffect(() => {
    let cancelled = false
    setAvailable(false)
    setStage({ kind: 'idle' })
    void moveAvailable(slotId).then((value) => {
      if (!cancelled) setAvailable(value)
    })
    return () => {
      cancelled = true
    }
  }, [slotId])

  // Read through a ref so a new callback from the page does not restart
  // the polling.
  const onMovedRef = useRef(onMoved)
  useEffect(() => {
    onMovedRef.current = onMoved
  }, [onMoved])

  const requestId = stage.kind === 'waiting' ? stage.requestId : null
  useEffect(() => {
    if (requestId === null) return
    let cancelled = false
    const timer = setInterval(() => {
      moveStatus(requestId)
        .then((status) => {
          if (cancelled || status === 'pending') return
          if (status === 'approved') {
            onMovedRef.current()
            return
          }
          setStage({ kind: 'done', status })
        })
        .catch(() => {
          // A dropped poll is retried on the next tick.
        })
    }, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [requestId])

  if (!available) return null

  async function ask() {
    setStage({ kind: 'sending' })
    try {
      setStage({ kind: 'waiting', requestId: await requestMove(slotId) })
    } catch (cause: unknown) {
      setStage({
        kind: 'failed',
        message: cause instanceof SlotActionError ? cause.message : 'Ada masalah. Cuba lagi.',
      })
    }
  }

  return (
    <div className="mb-4 rounded-lg border border-white/10 bg-white/5 p-3">
      {stage.kind === 'waiting' ? (
        <p className="font-sans text-[13px] leading-relaxed text-white/80">
          Mesej dihantar ke Telegram yang bersambung dengan slot ini. Buka Telegram dan tekan
          {' '}
          <span className="font-semibold text-white">Ya, pindahkan</span>. Halaman ini akan kemas kini sendiri.
        </p>
      ) : (
        <>
          <p className="mb-2 font-sans text-[13px] leading-relaxed text-white/70">
            Ini slot anda tapi tak boleh ubah? Mungkin anda tempah dari browser lain, contohnya dalam WhatsApp.
          </p>
          <Button
            variant="secondary"
            disabled={stage.kind === 'sending'}
            onClick={() => void ask()}
            className="w-full"
          >
            Ambil balik melalui Telegram
          </Button>
          {stage.kind === 'done' && (
            <p className="mt-2 font-sans text-xs text-white/60">{DONE_TEXT[stage.status]}</p>
          )}
          {stage.kind === 'failed' && <p className="mt-2 font-sans text-xs text-merah-soft">{stage.message}</p>}
        </>
      )}
    </div>
  )
}
