import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { AdminList } from '../components/AdminList'
import { Button } from '../components/Button'
import { inputClass } from '../components/Input'
import { SessionForm, type SessionFormValues } from '../components/SessionForm'
import { Sheet } from '../components/Sheet'
import { useToast } from '../components/Toast'
import { signIn, signOut, signUp, useAuthUser } from '../data/auth'
import { createSession, deleteSession, listSessions, nextSessionNo, setSessionStatus, updateSession } from '../data/sessions'
import type { Session } from '../data/types'
import { formatPlayDate, formatStartTime } from '../lib/format'

const DEFAULTS: SessionFormValues = {
  sessionNo: 1,
  title: '',
  playDate: '',
  startTime: '20:00',
  durationMins: 120,
  venue: '',
  feeMyr: null,
  teamAName: 'Merah',
  teamBName: 'Putih',
  teamCName: 'Kuning',
}

function LoginForm() {
  const { show } = useToast()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true)
    try {
      if (mode === 'signup') {
        await signUp(email, password)
        show('Akaun dicipta. Anda akan dimasukkan secara automatik.')
      } else {
        await signIn(email, password)
      }
    } catch (cause: unknown) {
      const message = cause instanceof Error ? cause.message : ''
      show(
        message.includes('Invalid login credentials')
          ? 'E-mel atau kata laluan salah.'
          : mode === 'signup'
            ? 'Gagal mendaftar. Cuba lagi.'
            : 'Gagal masuk. Cuba lagi.',
        'error',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-3 rounded-lg border border-white/10 bg-night-2 p-6">
        <h1 className="font-kit text-2xl font-semibold text-white">Admin</h1>
        <div className="space-y-1">
          <label htmlFor="email" className="block font-kit text-[13px] text-white/45">E-mel</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="password" className="block font-kit text-[13px] text-white/45">Kata laluan</label>
          <input
            id="password"
            type="password"
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
        </div>
        <Button variant="primary" disabled={busy} onClick={() => void submit()} className="w-full">
          {mode === 'signup' ? 'Daftar' : 'Masuk'}
        </Button>
        <button
          type="button"
          onClick={() => setMode(mode === 'signup' ? 'signin' : 'signup')}
          className="w-full text-center font-kit text-[13px] text-white/45"
        >
          {mode === 'signup' ? 'Dah ada akaun? Masuk' : 'Admin baru? Daftar di sini'}
        </button>
      </div>
    </div>
  )
}

/** Shown when a session resolved (there is an email) but the account holds
 *  no row in sepak.admins -- signing up creates an account, but it grants
 *  nothing on its own under the allowlist model. */
function NotAllowlisted() {
  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-3 rounded-lg border border-white/10 bg-night-2 p-6 text-center">
        <h1 className="font-kit text-2xl font-semibold text-white">Admin</h1>
        <p className="font-sans text-[15px] text-white/70">Akaun ini bukan admin. Minta admin utama tambah e-mel anda.</p>
        <Button variant="secondary" onClick={() => void signOut()} className="w-full">
          Keluar
        </Button>
      </div>
    </div>
  )
}

export default function Admin() {
  const { email, role, loading } = useAuthUser()
  const { show } = useToast()

  const [sessions, setSessions] = useState<Session[]>([])
  const [formValues, setFormValues] = useState<SessionFormValues | null>(null)
  // Bumped by every opener (openNew/openDuplicate/openEdit) and used as the
  // SessionForm's key, so the form always remounts with fresh internal state
  // instead of one opener's values leaking into the next via a preserved
  // instance — `key={editing?.id ?? 'new'}` would not distinguish "Sesi baru"
  // from "Duplikasi sesi lepas", since both map to 'new'.
  const [formKey, setFormKey] = useState(0)
  const [editing, setEditing] = useState<Session | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Session | null>(null)
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    try {
      setSessions(await listSessions())
    } catch {
      show('Gagal memuatkan senarai sesi.', 'error')
    }
  }, [show])

  useEffect(() => {
    if (role === null) return
    void reload()
  }, [role, reload])

  // openNew/openDuplicate fetch the next session number before they can
  // produce final form values, so the formKey bump has to land in the same
  // batch as setFormValues (i.e. after the await) rather than before it —
  // bumping it earlier would remount SessionForm once against the *old*
  // formValues (still on screen from a prior edit) and, since the key would
  // then be unchanged when the real values arrive, they'd never take.
  const openNew = useCallback(async () => {
    try {
      const sessionNo = await nextSessionNo()
      setEditing(null)
      setFormKey((key) => key + 1)
      setFormValues({ ...DEFAULTS, sessionNo })
    } catch {
      show('Gagal menyediakan borang sesi baru.', 'error')
    }
  }, [show])

  /** The weekly path: everything carries over except the date, which is the
   *  one field that genuinely changes. */
  const openDuplicate = useCallback(async () => {
    const last = sessions[0]
    if (last === undefined) {
      show('Belum ada sesi untuk diduplikasi.', 'error')
      return
    }
    try {
      const sessionNo = await nextSessionNo()
      setEditing(null)
      setFormKey((key) => key + 1)
      setFormValues({
        sessionNo,
        title: last.title,
        playDate: '',
        startTime: last.startTime.slice(0, 5),
        durationMins: last.durationMins,
        venue: last.venue,
        feeMyr: last.feeMyr,
        teamAName: last.teamNames.A,
        teamBName: last.teamNames.B,
        teamCName: last.teamNames.C,
      })
    } catch {
      show('Gagal menyediakan borang duplikasi.', 'error')
    }
  }, [sessions, show])

  function openEdit(session: Session) {
    setEditing(session)
    setFormKey((key) => key + 1)
    setFormValues({
      sessionNo: session.sessionNo,
      title: session.title,
      playDate: session.playDate,
      startTime: session.startTime.slice(0, 5),
      durationMins: session.durationMins,
      venue: session.venue,
      feeMyr: session.feeMyr,
      teamAName: session.teamNames.A,
      teamBName: session.teamNames.B,
      teamCName: session.teamNames.C,
    })
  }

  /** Every field stays editable after creation, including the fee: this
   *  payload is shared between creating and updating a session. */
  async function submit(values: SessionFormValues) {
    setBusy(true)
    try {
      const payload = {
        sessionNo: values.sessionNo,
        title: values.title,
        playDate: values.playDate,
        startTime: values.startTime,
        durationMins: values.durationMins,
        venue: values.venue,
        feeMyr: values.feeMyr,
        teamAName: values.teamAName,
        teamBName: values.teamBName,
        teamCName: values.teamCName,
      }

      if (editing !== null) {
        await updateSession(editing.id, payload)
        show('Sesi dikemas kini.')
      } else {
        await createSession(payload)
        show('Sesi dicipta.')
      }

      setFormValues(null)
      setEditing(null)
      await reload()
    } catch {
      show(editing !== null ? 'Gagal mengemas kini sesi.' : 'Gagal mencipta sesi.', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function toggleStatus(session: Session) {
    try {
      await setSessionStatus(session.id, session.status === 'open' ? 'closed' : 'open')
      await reload()
    } catch {
      show('Gagal menukar status sesi.', 'error')
    }
  }

  async function remove(session: Session) {
    try {
      await deleteSession(session.id)
      setConfirmDelete(null)
      await reload()
      show('Sesi dihapus.')
    } catch {
      show('Gagal menghapus sesi.', 'error')
    }
  }

  if (loading) return <p className="p-6 font-sans text-white/45">Memuatkan…</p>
  if (email === null) return <LoginForm />
  if (role === null) return <NotAllowlisted />

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 pb-24 md:p-8">
      <div className="flex items-center justify-between">
        <h1 className="font-kit text-3xl font-semibold text-white">Admin</h1>
        <Button variant="secondary" onClick={() => void signOut()}>
          Keluar
        </Button>
      </div>

      <div className={role === 'super' ? 'lg:grid lg:grid-cols-[1fr_360px] lg:items-start lg:gap-6' : ''}>
        <div className="space-y-4">
          <div className="flex gap-2">
            <Button variant="primary" onClick={() => void openNew()}>
              Sesi baru
            </Button>
            <Button variant="secondary" onClick={() => void openDuplicate()}>
              Duplikasi sesi lepas
            </Button>
          </div>

          <div className="divide-y divide-white/10 rounded-lg bg-night-2">
            {sessions.map((session) => (
              <div key={session.id} className="space-y-3 p-4 md:flex md:items-center md:justify-between md:gap-4 md:space-y-0">
                <div className="md:min-w-0 md:flex-1">
                  <p className="font-kit text-lg font-semibold text-white">
                    {`Sesi ${String(session.sessionNo).padStart(3, '0')} ${session.title}`}
                  </p>
                  <div className="mt-1 space-y-0.5 font-sans text-[13px] text-white/45">
                    <p>{formatPlayDate(session.playDate)}</p>
                    <p>{formatStartTime(session.startTime)}</p>
                    <p>{session.venue}</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 md:w-[190px] md:shrink-0 md:justify-end">
                  <Link
                    to={`/s/${session.id}`}
                    className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 font-kit text-xs font-semibold tracking-wide text-white transition active:brightness-110"
                  >
                    Buka
                  </Link>
                  <Button variant="secondary" className="px-3 py-2 text-xs" onClick={() => void toggleStatus(session)}>
                    {session.status === 'open' ? 'Tutup sesi' : 'Buka semula'}
                  </Button>
                  <Button variant="secondary" className="px-3 py-2 text-xs" onClick={() => openEdit(session)}>
                    Sunting
                  </Button>
                  <Button variant="destructive" className="px-3 py-2 text-xs" onClick={() => setConfirmDelete(session)}>
                    Hapus
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {role === 'super' && (
          <div className="mt-4 lg:mt-0">
            <AdminList currentEmail={email} />
          </div>
        )}
      </div>

      {formValues !== null && (
        <Sheet
          open
          title={editing !== null ? 'Sunting sesi' : 'Sesi baru'}
          onClose={() => { setFormValues(null); setEditing(null) }}
        >
          <SessionForm
            key={formKey}
            initial={formValues}
            submitLabel={editing !== null ? 'Simpan perubahan' : 'Cipta sesi'}
            busy={busy}
            onSubmit={(v) => void submit(v)}
          />
        </Sheet>
      )}

      {confirmDelete !== null && (
        <Sheet open title="Hapus sesi?" onClose={() => setConfirmDelete(null)}>
          <p className="mb-4 font-sans text-[15px] text-white/70">
            {`Sesi ${String(confirmDelete.sessionNo).padStart(3, '0')} dan semua slotnya akan hilang.`}
          </p>
          <Button variant="destructive" onClick={() => void remove(confirmDelete)} className="w-full">
            Ya, hapus
          </Button>
        </Sheet>
      )}
    </div>
  )
}
