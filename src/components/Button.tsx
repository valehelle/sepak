import type { ButtonHTMLAttributes } from 'react'

type ButtonVariant = 'primary' | 'secondary' | 'destructive'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
}

/** Base classes shared by every button in the app, regardless of variant --
 *  size, type, and font are never a per-call decision. */
const BASE =
  'rounded-lg px-4 py-2.5 font-kit text-[15px] font-semibold tracking-wide transition active:brightness-110 disabled:opacity-50 disabled:cursor-default'

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-turf-lit text-white',
  secondary: 'border border-white/15 bg-white/5 text-white',
  destructive: 'bg-merah text-white',
}

export function Button({ variant = 'primary', className, type = 'button', ...rest }: ButtonProps) {
  const classes = [BASE, VARIANT[variant], className].filter(Boolean).join(' ')
  return <button type={type} className={classes} {...rest} />
}
