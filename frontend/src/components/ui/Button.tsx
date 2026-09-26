import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react'
import { Link } from 'react-router'
import { t } from '../../strings/en'

type Variant = 'primary' | 'inverse' | 'outline' | 'text'

const BASE = 'motion-ui group relative inline-flex min-h-12 w-full items-center justify-between gap-4 px-4 t-label-lg transition-colors duration-200 ease-brand disabled:cursor-not-allowed disabled:opacity-60'
const VARIANTS: Record<Variant, string> = {
  // Solid ink rectangle; hover/focus → #000 and the arrow slides 4px right (DESIGN.md §5).
  primary: 'bg-ink text-paper hover:bg-black focus-visible:bg-black',
  // White fill with ink text, full width, for dark panels (form submits).
  inverse: 'bg-paper text-ink hover:bg-bone focus-visible:bg-bone',
  // Inverse with an ink hairline, for secondary actions on light surfaces (EDIT, HOLD TO ASK).
  outline: 'bg-paper text-ink border border-ink hover:bg-bone focus-visible:bg-bone',
  text: '',
}

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  arrow?: boolean
  children: ReactNode
  ref?: Ref<HTMLButtonElement>
}

function Arrow() {
  return (
    <span aria-hidden className="motion-ui transition-transform duration-200 ease-brand group-hover:translate-x-1 group-focus-visible:translate-x-1">
      {t.arrow}
    </span>
  )
}

export function Button({ variant = 'primary', arrow = variant !== 'text', className = '', children, type = 'button', ...rest }: Props) {
  if (variant === 'text') {
    return (
      <button type={type} className={`t-label min-h-12 underline underline-offset-4 decoration-1 ${className}`} {...rest}>
        {children}
      </button>
    )
  }
  return (
    <button type={type} className={`${BASE} ${VARIANTS[variant]} ${className}`} {...rest}>
      <span>{children}</span>
      {arrow && <Arrow />}
    </button>
  )
}

export function ButtonLink({ to, variant = 'primary', className = '', children }:
  { to: string; variant?: Exclude<Variant, 'text'>; className?: string; children: ReactNode }) {
  return (
    <Link to={to} className={`${BASE} ${VARIANTS[variant]} ${className}`}>
      <span>{children}</span>
      <Arrow />
    </Link>
  )
}
