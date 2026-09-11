import { useState } from 'react'
import { useToast } from './Toast'

type CopyButtonProps = { text: string; label: string }

export function CopyButton({ text, label }: CopyButtonProps) {
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
        copied
          ? 'border-turf-lit bg-turf-lit text-white'
          : 'border-white/15 bg-white/5 text-white active:bg-white/10',
      ].join(' ')}
    >
      {copied ? 'Dah disalin' : label}
    </button>
  )
}
