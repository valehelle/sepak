import { useState } from 'react'
import {
  AccountError,
  isInAppBrowser,
  sendPasswordReset,
  signInWithEmail,
  signInWithGoogle,
  signUpWithEmail,
} from '../data/account'
import { Button } from './Button'
import { inputClass } from './Input'
import { Sheet } from './Sheet'

type Mode = 'signin' | 'signup' | 'forgot'

type LoginSheetProps = {
  open: boolean
  /** Why sign-in is being asked for, shown above the buttons. */
  reason: string
  /** Where Google and the reset email send the player back to. */
  returnTo: string
  onClose: () => void
}

/** Sign in, or make an account, before booking. Google is one tap; email
 *  and password is for anyone without a Google account. */
export function LoginSheet({ open, reason, returnTo, onClose }: LoginSheetProps) {
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const inApp = isInAppBrowser()

  function switchTo(next: Mode) {
    setMode(next)
    setProblem(null)
    setSent(false)
  }

  async function attempt(action: () => Promise<void>) {
    setBusy(true)
    setProblem(null)
    try {
      await action()
    } catch (cause: unknown) {
      setProblem(cause instanceof AccountError ? cause.message : 'Ada masalah. Cuba lagi.')
    } finally {
      setBusy(false)
    }
  }

  function submit() {
    if (email.trim() === '') return setProblem('Isi emel anda.')
    if (mode === 'forgot') {
      void attempt(async () => {
        await sendPasswordReset(email, returnTo)
        setSent(true)
      })
      return
    }
    if (password === '') return setProblem('Isi kata laluan.')
    if (mode === 'signup' && password.length < 6) return setProblem('Kata laluan perlu sekurang-kurangnya 6 aksara.')
    void attempt(async () => {
      if (mode === 'signup') await signUpWithEmail(email, password)
      else await signInWithEmail(email, password)
      onClose()
    })
  }

  const title = mode === 'signup' ? 'Daftar akaun' : mode === 'forgot' ? 'Lupa kata laluan' : 'Log masuk'

  return (
    <Sheet open={open} title={title} onClose={onClose}>
      {mode !== 'forgot' && (
        <>
          <p className="mb-4 font-sans text-[14px] leading-relaxed text-white/70">{reason}</p>
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => void attempt(() => signInWithGoogle(returnTo))}
            className="w-full"
          >
            Log masuk dengan Google
          </Button>
          {inApp && (
            <p className="mt-2 font-sans text-xs leading-relaxed text-kuning">
              Google tak benarkan log masuk dalam browser aplikasi ini. Buka pautan dalam Chrome
              atau Safari, atau guna emel di bawah.
            </p>
          )}
          <p className="my-4 text-center font-kit text-[13px] text-white/40">atau guna emel</p>
        </>
      )}

      {mode === 'forgot' && sent ? (
        <p className="mb-4 font-sans text-[14px] leading-relaxed text-white/80">
          Kalau emel ini ada akaun, pautan untuk tukar kata laluan dah dihantar. Semak peti masuk
          (dan folder spam).
        </p>
      ) : (
        <>
          <label htmlFor="login-email" className="mb-1 block font-kit text-[13px] text-white/45">Emel</label>
          <input
            id="login-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setProblem(null) }}
            className={`mb-3 ${inputClass}`}
          />
          {mode !== 'forgot' && (
            <>
              <label htmlFor="login-password" className="mb-1 block font-kit text-[13px] text-white/45">
                Kata laluan
              </label>
              <input
                id="login-password"
                type="password"
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => { setPassword(e.target.value); setProblem(null) }}
                onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
                className={`mb-3 ${inputClass}`}
              />
            </>
          )}
          {problem !== null && <p className="mb-2 font-sans text-xs text-merah-soft">{problem}</p>}
          <Button variant="secondary" disabled={busy} onClick={submit} className="w-full">
            {mode === 'signup' ? 'Daftar' : mode === 'forgot' ? 'Hantar pautan' : 'Log masuk'}
          </Button>
        </>
      )}

      <div className="mt-4 flex flex-wrap justify-center gap-x-4 gap-y-2 font-kit text-[13px] text-white/60">
        {mode !== 'signin' && (
          <button type="button" onClick={() => switchTo('signin')} className="underline decoration-white/20 underline-offset-4">
            Dah ada akaun? Log masuk
          </button>
        )}
        {mode !== 'signup' && (
          <button type="button" onClick={() => switchTo('signup')} className="underline decoration-white/20 underline-offset-4">
            Belum ada akaun? Daftar
          </button>
        )}
        {mode === 'signin' && (
          <button type="button" onClick={() => switchTo('forgot')} className="underline decoration-white/20 underline-offset-4">
            Lupa kata laluan
          </button>
        )}
      </div>
    </Sheet>
  )
}
