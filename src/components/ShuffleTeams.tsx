import { useState } from 'react'
import { Button } from './Button'

type ShuffleTeamsProps = {
  busy: boolean
  onShuffle: () => void
}

/** Admin only. Asks once before moving every team, since one tap reshapes
 *  the whole session. */
export function ShuffleTeams({ busy, onShuffle }: ShuffleTeamsProps) {
  const [confirming, setConfirming] = useState(false)

  if (!confirming) {
    return (
      <Button variant="secondary" disabled={busy} onClick={() => setConfirming(true)} className="w-full">
        🔀 Rombak team
      </Button>
    )
  }

  return (
    <div className="space-y-2 rounded-lg border border-kuning/40 bg-kuning/10 p-3">
      <p className="font-sans text-[13px] text-white/80">
        Setiap team pindah bersama ke team lain secara rawak. Posisi dan tanda bayar kekal.
      </p>
      <Button
        disabled={busy}
        onClick={() => {
          setConfirming(false)
          onShuffle()
        }}
        className="w-full"
      >
        Ya, rombak
      </Button>
      <Button variant="secondary" disabled={busy} onClick={() => setConfirming(false)} className="w-full">
        Batal
      </Button>
    </div>
  )
}
