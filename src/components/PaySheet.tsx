import { useEffect, useRef, useState } from 'react'
import { attachReceipt, uploadReceipt } from '../data/receipts'
import { SlotActionError } from '../data/slots'
import type { Slot } from '../data/types'
import { shrinkImage } from '../lib/image'
import { Button } from './Button'
import { Sheet } from './Sheet'

type PaySheetProps = {
  /** The player's own slot, or null when the sheet is closed. */
  slot: Slot | null
  onClose: () => void
  /** Ticked with a receipt attached; the slot as the server now has it. */
  onPaidWithReceipt: (slot: Slot) => void
  /** Ticked without one -- the receipt is optional. */
  onPaidWithoutReceipt: () => void
}

/** Ticking paid, receipt first. The receipt is optional, but it is the big
 *  button: the bank prints the sender's name and the time on it, which is
 *  what the organiser matches against in the bank app. */
export function PaySheet({ slot, onClose, onPaidWithReceipt, onPaidWithoutReceipt }: PaySheetProps) {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setFile(null)
    setProblem(null)
  }, [slot?.id])

  useEffect(() => {
    if (file === null) {
      setPreview(null)
      return
    }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  if (slot === null) return null

  async function send() {
    if (slot === null || file === null) return
    setBusy(true)
    setProblem(null)
    try {
      const image = await shrinkImage(file)
      const path = await uploadReceipt(slot, image)
      onPaidWithReceipt(await attachReceipt(slot.id, path))
    } catch (cause: unknown) {
      setProblem(cause instanceof SlotActionError ? cause.message : 'Gagal menghantar resit. Cuba lagi.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open title="Tandakan dah bayar" onClose={onClose}>
      <p className="mb-4 font-sans text-[14px] leading-relaxed text-white/70">
        Muat naik resit transfer supaya admin senang semak nama dan masa dalam akaun bank.
      </p>

      <input
        ref={input}
        type="file"
        accept="image/*"
        aria-label="Pilih gambar resit"
        className="hidden"
        onChange={(event) => {
          setFile(event.target.files?.[0] ?? null)
          setProblem(null)
        }}
      />

      {preview !== null && (
        <img
          src={preview}
          alt="Resit yang dipilih"
          className="mb-3 max-h-64 w-full rounded-lg border border-white/10 object-contain"
        />
      )}

      {file === null ? (
        <Button variant="primary" disabled={busy} onClick={() => input.current?.click()} className="w-full">
          📷 Muat naik resit
        </Button>
      ) : (
        <div className="space-y-2">
          <Button variant="primary" disabled={busy} onClick={() => void send()} className="w-full">
            {busy ? 'Menghantar…' : 'Hantar'}
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => input.current?.click()} className="w-full">
            Tukar gambar
          </Button>
        </div>
      )}

      {problem !== null && <p className="mt-2 font-sans text-xs text-merah-soft">{problem}</p>}

      <button
        type="button"
        disabled={busy}
        onClick={onPaidWithoutReceipt}
        className="mt-4 w-full font-kit text-[13px] text-white/50 underline decoration-white/20 underline-offset-4"
      >
        Tandakan tanpa resit
      </button>
    </Sheet>
  )
}
