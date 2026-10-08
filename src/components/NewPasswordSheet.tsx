import { useEffect, useState } from 'react'
import { AccountError, setNewPassword } from '../data/account'
import { supabase } from '../lib/supabase'
import { Button } from './Button'
import { inputClass } from './Input'
import { Sheet } from './Sheet'
import { useToast } from './Toast'

/** Mounted once for the whole app. A reset link from "Lupa kata laluan"
 *  signs the player in for recovery and lands on whatever page it was sent
 *  from; this is what notices and asks for the new password. */
export function NewPasswordSheet() {
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const { show } = useToast()

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setOpen(true)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  async function save() {
    if (password.length < 6) return setProblem('Kata laluan perlu sekurang-kurangnya 6 aksara.')
    setBusy(true)
    try {
      await setNewPassword(password)
      setOpen(false)
      setPassword('')
      show('Kata laluan ditukar.')
    } catch (cause: unknown) {
      setProblem(cause instanceof AccountError ? cause.message : 'Gagal menukar kata laluan.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} title="Kata laluan baru" onClose={() => setOpen(false)}>
      <label htmlFor="new-password" className="mb-1 block font-kit text-[13px] text-white/45">Kata laluan baru</label>
      <input
        id="new-password"
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={(e) => { setPassword(e.target.value); setProblem(null) }}
        onKeyDown={(e) => { if (e.key === 'Enter') void save() }}
        className={`mb-3 ${inputClass}`}
      />
      {problem !== null && <p className="mb-2 font-sans text-xs text-merah-soft">{problem}</p>}
      <Button variant="primary" disabled={busy} onClick={() => void save()} className="w-full">
        Simpan kata laluan
      </Button>
    </Sheet>
  )
}
