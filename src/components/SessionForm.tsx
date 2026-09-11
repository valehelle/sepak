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

      <div className="grid grid-cols-3 gap-2 md:col-span-2">
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
