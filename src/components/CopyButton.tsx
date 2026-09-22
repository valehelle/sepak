import { useState } from 'react'
import { useToast } from './Toast'

/** `emphasis` ranks this against whatever sits next to it. The organiser's
 *  panel has only this one button, so it stays quiet there; in a sheet whose
 *  whole purpose is the copy, it has to outrank the close button. */
type CopyButtonProps = { text: string; label: string; emphasis?: 'quiet' | 'primary' }

export function CopyButton({ text, label, emphasis = 'quiet' }: CopyButtonProps) {
  const { show } = useToast()
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      show('Gagal menyalin. Cuba tekan lama untuk pilih teks.', 'error')
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className={[
        'w-full rounded-lg border px-4 py-3 font-kit text-[15px] font-semibold tracking-wide transition',
        // Copied always lands on green. The idle state is what differs, so
        // the flip stays visible either way.
        copied
          ? 'border-turf-lit bg-turf-lit text-white'
          : emphasis === 'primary'
            ? 'border-turf-lit/70 bg-turf text-white active:bg-turf-lit'
            : 'border-white/15 bg-white/5 text-white active:bg-white/10',
      ].join(' ')}
    >
      {copied ? 'Dah disalin' : label}
    </button>
  )
}
