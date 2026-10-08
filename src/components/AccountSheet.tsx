import { useEffect, useState } from 'react'
import { AccountError, saveProfile, signOutPlayer, type Profile } from '../data/account'
import { formatPhone, normalisePhone } from '../lib/phone'
import { Button } from './Button'
import { inputClass } from './Input'
import { PhoneField } from './PhoneField'
import { Sheet } from './Sheet'

type AccountSheetProps = {
  open: boolean
  userId: string
  email: string | null
  profile: Profile | null
  onSaved: (profile: Profile) => void
  onClose: () => void
}

/** Who you are signed in as, the name and number bookings use, and sign-out. */
export function AccountSheet({ open, userId, email, profile, onSaved, onClose }: AccountSheetProps) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setName(profile?.name ?? '')
    setPhone(profile === null ? '' : formatPhone(profile.phone))
    setProblem(null)
  }, [open, profile])

  async function save() {
    const trimmed = name.trim()
    if (trimmed === '' || trimmed.length > 40) return setProblem('Isi nama (1 hingga 40 aksara).')
    const stored = normalisePhone(phone)
    if (stored === null) return setProblem('Nombor telefon tak sah. Contoh: 012-345 6789.')
    setBusy(true)
    try {
      await saveProfile(userId, { name: trimmed, phone: stored })
      onSaved({ name: trimmed, phone: stored })
      onClose()
    } catch (cause: unknown) {
      setProblem(cause instanceof AccountError ? cause.message : 'Gagal menyimpan.')
    } finally {
      setBusy(false)
    }
  }

  async function signOut() {
    setBusy(true)
    try {
      await signOutPlayer()
      onClose()
    } catch {
      setProblem('Gagal log keluar. Cuba lagi.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} title="Akaun" onClose={onClose}>
      {email !== null && <p className="mb-4 font-sans text-[14px] text-white/60">{email}</p>}
      <p className="mb-3 font-sans text-[13px] leading-relaxed text-white/60">
        Nama dan nombor ini diisi terus bila anda ambil slot.
      </p>
      <label htmlFor="account-name" className="mb-1 block font-kit text-[13px] text-white/45">Nama</label>
      <input
        id="account-name"
        value={name}
        maxLength={40}
        autoComplete="name"
        onChange={(e) => { setName(e.target.value); setProblem(null) }}
        className={`mb-3 ${inputClass}`}
      />
      <PhoneField id="account-phone" value={phone} onChange={(v) => { setPhone(v); setProblem(null) }} onEnter={() => void save()} />
      {problem !== null && <p className="mb-2 font-sans text-xs text-merah-soft">{problem}</p>}
      <Button variant="primary" disabled={busy} onClick={() => void save()} className="mb-2 w-full">
        Simpan
      </Button>
      <Button variant="secondary" disabled={busy} onClick={() => void signOut()} className="w-full">
        Log keluar
      </Button>
    </Sheet>
  )
}
