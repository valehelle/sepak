import { inputClass } from './Input'

type PhoneFieldProps = {
  id: string
  value: string
  onChange: (value: string) => void
  onEnter: () => void
}

/** One phone input for both sheets. `type="tel"` + `autoComplete="tel"` is
 *  what lets iOS and Android offer the device's own number above the
 *  keyboard, so most people fill this with one tap and never type it. */
export function PhoneField({ id, value, onChange, onEnter }: PhoneFieldProps) {
  return (
    <>
      <label htmlFor={id} className="mb-1 block font-kit text-[13px] text-white/45">
        Nombor telefon
      </label>
      <input
        id={id}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        placeholder="012-345 6789"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter') onEnter() }}
        maxLength={20}
        className={`mb-2 ${inputClass}`}
      />
      <p className="mb-3 font-sans text-[12px] text-white/40">Hanya admin boleh lihat nombor ini.</p>
    </>
  )
}
