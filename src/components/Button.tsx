import type { ButtonHTMLAttributes } from 'react'

export type ButtonVariant = 'primary' | 'secondary' | 'destructive'
export type ButtonSize = 'md' | 'sm'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
}

/** Shared by every button regardless of variant or size. Font size and
 *  padding are deliberately NOT here: they come from SIZE, so a caller can
 *  never half-override them with a stray `text-xs` and land on whichever
 *  utility Tailwind happened to emit last. */
const BASE =
  'inline-flex items-center justify-center whitespace-nowrap rounded-lg font-kit font-semibold tracking-wide transition active:brightness-110 disabled:opacity-50 disabled:cursor-default'

const SIZE: Record<ButtonSize, string> = {
  md: 'px-4 py-2.5 text-[15px]',
  sm: 'px-3 py-2 text-[13px]',
}

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-turf-lit text-white',
  secondary: 'border border-white/15 bg-white/5 text-white',
  destructive: 'bg-merah text-white',
}

/** The exact class string a Button renders with -- for the rare element that
 *  must look like a button but be something else (a router Link). */
export function buttonClass(variant: ButtonVariant = 'primary', size: ButtonSize = 'md'): string {
  return [BASE, SIZE[size], VARIANT[variant]].join(' ')
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  const classes = [buttonClass(variant, size), className].filter(Boolean).join(' ')
  return <button type={type} className={classes} {...rest} />
}
