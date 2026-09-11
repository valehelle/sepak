import { useState, type ReactNode } from 'react'
import { formatPlayDate } from '../lib/format'

export type SessionFormValues = {
  sessionNo: number
  title: string
  playDate: string
  startTime: string
  durationMins: number
  venue: string
  feeMyr: number | null
  teamAName: string
  teamBName: string
  teamCName: string
}

type SessionFormProps = {
  initial: SessionFormValues
  submitLabel: string
  busy: boolean
  onSubmit: (values: SessionFormValues) => void
}

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-xs font-semibold text-slate-400">{label}</label>
      {children}
    </div>
  )
}

const inputClass =
  'w-full rounded-2xl bg-slate-800 px-4 py-3 text-base outline-none ring-emerald-400 focus:ring-2'

export function SessionForm({ initial, submitLabel, busy, onSubmit }: SessionFormProps) {
  const [values, setValues] = useState(initial)
  // Fee is held as text so an empty box stays empty rather than snapping to 0.
  const [feeText, setFeeText] = useState(initial.feeMyr === null ? '' : String(initial.feeMyr))
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

    const trimmedFee = feeText.trim()
    const fee = trimmedFee === '' ? null : Number(trimmedFee)
    if (fee !== null && (!Number.isFinite(fee) || fee < 0)) return setProblem('Yuran tak sah.')

    onSubmit({
      ...values,
      title: values.title.trim(),
      venue: values.venue.trim(),
      feeMyr: fee,
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
    <div className="space-y-3">
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

      <Field id="title" label="Nama sesi">
        <input id="title" value={values.title} onChange={(e) => set('title', e.target.value)} className={inputClass} />
      </Field>

      <Field id="play-date" label="Tarikh">
        <input
          id="play-date"
          type="date"
          value={values.playDate}
          onChange={(e) => set('playDate', e.target.value)}
          className={inputClass}
        />
      </Field>
      {dayHint !== null && <p className="text-xs text-emerald-400">{dayHint}</p>}

      <Field id="start-time" label="Masa">
        <input
          id="start-time"
          type="time"
          value={values.startTime}
          onChange={(e) => set('startTime', e.target.value)}
          className={inputClass}
        />
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

      <Field id="venue" label="Tempat">
        <input id="venue" value={values.venue} onChange={(e) => set('venue', e.target.value)} className={inputClass} />
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

      <div className="grid grid-cols-3 gap-2">
        <Field id="team-a" label="Pasukan A">
          <input id="team-a" value={values.teamAName} onChange={(e) => set('teamAName', e.target.value)} className={inputClass} />
        </Field>
        <Field id="team-b" label="Pasukan B">
          <input id="team-b" value={values.teamBName} onChange={(e) => set('teamBName', e.target.value)} className={inputClass} />
        </Field>
        <Field id="team-c" label="Pasukan C">
          <input id="team-c" value={values.teamCName} onChange={(e) => set('teamCName', e.target.value)} className={inputClass} />
        </Field>
      </div>

      {problem !== null && <p className="text-xs text-red-400">{problem}</p>}

      <button
        type="button"
        disabled={busy}
        onClick={submit}
        className="w-full rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-bold text-slate-950 active:bg-emerald-400 disabled:opacity-60"
      >
        {submitLabel}
      </button>
    </div>
  )
}
