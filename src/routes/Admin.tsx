import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { ActivityFeed } from '../components/ActivityFeed'
import { AdminList } from '../components/AdminList'
import { Button, buttonClass } from '../components/Button'
import { inputClass } from '../components/Input'
import { SessionForm, type SessionFormValues } from '../components/SessionForm'
import { Sheet } from '../components/Sheet'
import { useToast } from '../components/Toast'
import { signIn, signOut, signUp, useAuthUser } from '../data/auth'
import { createSession, deleteSession, listSessions, nextSessionNo, sessionTeamCount, setSessionStatus, updateSession } from '../data/sessions'
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
  feeGkMyr: null,
  teamAName: 'Merah A',
  teamBName: 'Merah B',
  teamCName: 'Kuning A',
  teamDName: 'Kuning B',
}

/** The duplicated session's team names, if they still work for four teams.
 *  A three-team session never had a real Team D name -- its C and D are
 *  both "Kuning" -- so it gets the four-team defaults instead. */
function teamNamesFrom(session: Session): Pick<SessionFormValues, 'teamAName' | 'teamBName' | 'teamCName' | 'teamDName'> {
  const { A, B, C, D } = session.teamNames
  const distinct = new Set([A, B, C, D].map((name) => name.trim().toLowerCase())).size === 4
  if (!distinct) {
    return { teamAName: DEFAULTS.teamAName, teamBName: DEFAULTS.teamBName, teamCName: DEFAULTS.teamCName, teamDName: DEFAULTS.teamDName }
  }
  return { teamAName: A, teamBName: B, teamCName: C, teamDName: D }
}

/** Supabase error strings the form can explain better than "Cuba lagi".
 *  Matched by substring: GoTrue's messages are stable English prose, not
 *  codes, at the supabase-js level. */
function loginErrorMessage(message: string, mode: 'signin' | 'signup'): string {
  if (message.includes('Invalid login credentials')) return 'E-mel atau kata laluan salah.'
  if (message.includes('Email not confirmed')) {
    return 'Akaun ini belum disahkan. Admin utama perlu matikan pengesahan e-mel dalam Supabase.'
  }
  if (message.includes('already registered')) return 'E-mel ini sudah berdaftar. Masuk sahaja.'
  if (message.includes('Password should be at least')) return 'Kata laluan sekurang-kurangnya 6 aksara.'
  if (message.includes('is invalid')) return 'E-mel tidak sah.'
  return mode === 'signup' ? 'Gagal mendaftar. Cuba lagi.' : 'Gagal masuk. Cuba lagi.'
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
        const { signedIn } = await signUp(email, password)
        if (signedIn) {
          show('Akaun dicipta. Anda dimasukkan sekarang.')
        } else {
          // The account exists but is unusable until a confirmation email
          // that will never arrive is clicked -- do not call that success.
          show(
            'Akaun dicipta tetapi belum aktif: pengesahan e-mel masih dihidupkan dalam Supabase. Admin utama perlu matikannya.',
            'error',
          )
        }
      } else {
        await signIn(email, password)
      }
    } catch (cause: unknown) {
      show(loginErrorMessage(cause instanceof Error ? cause.message : '', mode), 'error')
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
  // New sessions always get four teams; an older one being edited may have
  // three, and then Team D's name is neither shown nor checked.
  const [teamCount, setTeamCount] = useState<3 | 4>(4)
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
        feeGkMyr: last.feeGkMyr,
        ...teamNamesFrom(last),
      })
    } catch {
      show('Gagal menyediakan borang duplikasi.', 'error')
    }
  }, [sessions, show])

  async function openEdit(session: Session) {
    let teams: 3 | 4
    try {
      teams = await sessionTeamCount(session.id)
    } catch {
      show('Gagal membuka sesi.', 'error')
      return
    }
    setTeamCount(teams)
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
      feeGkMyr: session.feeGkMyr,
      teamAName: session.teamNames.A,
      teamBName: session.teamNames.B,
      teamCName: session.teamNames.C,
      teamDName: session.teamNames.D,
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
        feeGkMyr: values.feeGkMyr,
        teamAName: values.teamAName,
        teamBName: values.teamBName,
        teamCName: values.teamCName,
        teamDName: values.teamDName,
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
                <div className="grid grid-cols-2 gap-2 md:w-[264px] md:shrink-0">
                  <Link
                    to={`/s/${session.id}`}
                    className={buttonClass('secondary', 'sm')}
                  >
                    Buka
                  </Link>
                  <Button variant="secondary" size="sm" className="w-full" onClick={() => void toggleStatus(session)}>
                    {session.status === 'open' ? 'Tutup sesi' : 'Buka semula'}
                  </Button>
                  <Button variant="secondary" size="sm" className="w-full" onClick={() => void openEdit(session)}>
                    Sunting
                  </Button>
                  <Button variant="destructive" size="sm" className="w-full" onClick={() => setConfirmDelete(session)}>
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

      {/* Below the sessions: the log is what you read after the fact, not
          what you come here to do. */}
      <ActivityFeed />

      {formValues !== null && (
        <Sheet
          open
          title={editing !== null ? 'Sunting sesi' : 'Sesi baru'}
          onClose={() => { setFormValues(null); setEditing(null) }}
        >
          <SessionForm
            key={formKey}
            initial={formValues}
            teamCount={editing !== null ? teamCount : 4}
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
