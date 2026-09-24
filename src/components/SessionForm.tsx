import { useState, type ReactNode } from 'react'
import { formatPlayDate } from '../lib/format'
import { Button } from './Button'
import { inputClass } from './Input'

export type SessionFormValues = {
  sessionNo: number
  title: string
  playDate: string
  startTime: string
  durationMins: number
  venue: string
  feeMyr: number | null
  feeGkMyr: number | null
  teamAName: string
  teamBName: string
  teamCName: string
  teamDName: string
  /** `datetime-local` text in local time, e.g. "2026-09-25T21:00". */
  opensAt: string
}

type SessionFormProps = {
  initial: SessionFormValues
  /** 3 for a session made before Team D: its D name is kept but not shown. */
  teamCount?: 3 | 4
  /** The opening time has passed, so the database will refuse a change. */
  opensLocked?: boolean
  submitLabel: string
  busy: boolean
  onSubmit: (values: SessionFormValues) => void
}

function Field({
  id,
  label,
  className,
  children,
}: {
  id: string
  label: string
  className?: string
  children: ReactNode
}) {
  return (
    <div className={['space-y-1', className].filter(Boolean).join(' ')}>
      <label htmlFor={id} className="block font-kit text-[13px] text-white/45">{label}</label>
      {children}
    </div>
  )
}

export function SessionForm({ initial, teamCount = 4, opensLocked = false, submitLabel, busy, onSubmit }: SessionFormProps) {
  const [values, setValues] = useState(initial)
  // Fee is held as text so an empty box stays empty rather than snapping to 0.
  const [feeText, setFeeText] = useState(initial.feeMyr === null ? '' : String(initial.feeMyr))
  const [gkFeeText, setGkFeeText] = useState(initial.feeGkMyr === null ? '' : String(initial.feeGkMyr))
  const [problem, setProblem] = useState<string | null>(null)

  function set<K extends keyof SessionFormValues>(key: K, value: SessionFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }))
    setProblem(null)
  }

  function submit() {
    if (values.title.trim() === '') return setProblem('Isi nama sesi.')
    if (values.venue.trim() === '') return setProblem('Isi tempat.')
    if (values.playDate === '') return setProblem('Pilih tarikh.')
    if (values.startTime === '') return setProblem('Pilih masa.')
    if (values.opensAt === '') return setProblem('Pilih masa dibuka.')

    // Teams are told apart by name alone (see teamLabel), so two teams with
    // the same name would be two identical headings and two identical
    // blocks in the WhatsApp list.
    const names = [values.teamAName, values.teamBName, values.teamCName, values.teamDName]
      .slice(0, teamCount)
      .map((name) => name.trim().toLowerCase())
    if (new Set(names).size !== names.length) return setProblem('Setiap pasukan perlukan nama berbeza.')

    const trimmedFee = feeText.trim()
    const fee = trimmedFee === '' ? null : Number(trimmedFee)
    if (fee !== null && (!Number.isFinite(fee) || fee < 0)) return setProblem('Yuran tak sah.')

    const trimmedGkFee = gkFeeText.trim()
    const gkFee = trimmedGkFee === '' ? null : Number(trimmedGkFee)
    if (gkFee !== null && (!Number.isFinite(gkFee) || gkFee < 0)) return setProblem('Yuran GK tak sah.')

    onSubmit({
      ...values,
      title: values.title.trim(),
      venue: values.venue.trim(),
      feeMyr: fee,
      feeGkMyr: gkFee,
    })
  }

  let dayHint: string | null = null
  if (values.playDate !== '') {
    try {
      dayHint = formatPlayDate(values.playDate)
    } catch {
      dayHint = null
    }
  }

  return (
    <div className="space-y-3 md:grid md:grid-cols-2 md:gap-x-4 md:gap-y-3 md:space-y-0">
      <Field id="play-date" label="Tarikh">
        <input
          id="play-date"
          type="date"
          value={values.playDate}
          onChange={(e) => set('playDate', e.target.value)}
          className={inputClass}
        />
        {dayHint !== null && <p className="font-sans text-xs text-turf-lit">{dayHint}</p>}
      </Field>

      <Field id="start-time" label="Masa">
        <input
          id="start-time"
          type="time"
          value={values.startTime}
          onChange={(e) => set('startTime', e.target.value)}
          className={inputClass}
        />
      </Field>

      <Field id="opens-at" label="Dibuka pada" className="md:col-span-2">
        <input
          id="opens-at"
          type="datetime-local"
          required
          disabled={opensLocked}
          value={values.opensAt}
          onChange={(e) => set('opensAt', e.target.value)}
          className={inputClass}
        />
        <p className="font-sans text-xs text-white/45">
          {opensLocked
            ? 'Dah dibuka. Masa dibuka tak boleh ditukar lagi.'
            : 'Sebelum masa ini, hanya admin boleh daftar. Boleh ditukar sehingga masa ini tiba.'}
        </p>
      </Field>

      <Field id="duration" label="Tempoh (minit)">
        <input
          id="duration"
          type="number"
          inputMode="numeric"
          value={values.durationMins}
          onChange={(e) => set('durationMins', Number(e.target.value))}
          className={inputClass}
        />
      </Field>

      <Field id="fee" label="Yuran (RM)">
        <input
          id="fee"
          type="number"
          inputMode="decimal"
          step="0.50"
          placeholder="Kosongkan jika percuma"
          value={feeText}
          onChange={(e) => { setFeeText(e.target.value); setProblem(null) }}
          className={inputClass}
        />
      </Field>

      <Field id="fee-gk" label="Yuran GK (RM)">
        <input
          id="fee-gk"
          type="number"
          inputMode="decimal"
          step="0.50"
          placeholder="Kosongkan jika sama"
          value={gkFeeText}
          onChange={(e) => { setGkFeeText(e.target.value); setProblem(null) }}
          className={inputClass}
        />
      </Field>

      <Field id="session-no" label="Sesi no.">
        <input
          id="session-no"
          type="number"
          inputMode="numeric"
          value={values.sessionNo}
          onChange={(e) => set('sessionNo', Number(e.target.value))}
          className={inputClass}
        />
      </Field>

      <Field id="title" label="Nama sesi" className="md:col-span-2">
        <input id="title" value={values.title} onChange={(e) => set('title', e.target.value)} className={inputClass} />
      </Field>

      <Field id="venue" label="Tempat" className="md:col-span-2">
        <input id="venue" value={values.venue} onChange={(e) => set('venue', e.target.value)} className={inputClass} />
      </Field>

      <div className="grid grid-cols-2 gap-2 md:col-span-2 md:grid-cols-4">
        <Field id="team-a" label="Pasukan A">
          <input id="team-a" value={values.teamAName} onChange={(e) => set('teamAName', e.target.value)} className={inputClass} />
        </Field>
        <Field id="team-b" label="Pasukan B">
          <input id="team-b" value={values.teamBName} onChange={(e) => set('teamBName', e.target.value)} className={inputClass} />
        </Field>
        <Field id="team-c" label="Pasukan C">
          <input id="team-c" value={values.teamCName} onChange={(e) => set('teamCName', e.target.value)} className={inputClass} />
        </Field>
        {teamCount === 4 && (
          <Field id="team-d" label="Pasukan D">
            <input id="team-d" value={values.teamDName} onChange={(e) => set('teamDName', e.target.value)} className={inputClass} />
          </Field>
        )}
      </div>

      {problem !== null && <p className="font-sans text-xs text-merah-soft md:col-span-2">{problem}</p>}

      <Button
        type="button"
        variant="primary"
        disabled={busy}
        onClick={submit}
        className="w-full md:col-span-2"
      >
        {submitLabel}
      </Button>
    </div>
  )
}
