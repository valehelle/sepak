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
      className="w-full rounded-2xl bg-slate-800 px-4 py-3 text-sm font-semibold text-slate-100 active:bg-slate-700"
    >
      {copied ? '✅ Dah disalin' : `📋 ${label}`}
    </button>
  )
}
