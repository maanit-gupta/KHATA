import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { NavLink } from 'react-router'

/**
 * Nav chip: solid ink, white uppercase text, 6px 10px padding. The active chip is underlined.
 * Hover: fill → #2E2F33 and the underline slides in over 200ms. The visible chip is small, but
 * the hit area is always ≥48×48 (DESIGN.md §4).
 */
function ChipFace({ active, children, blend }: { active: boolean; children: ReactNode; blend?: boolean }) {
  return (
    <span
      className={`motion-ui relative inline-flex items-center px-[10px] py-[6px] t-label text-paper transition-colors duration-200 ease-brand
        ${blend ? 'bg-transparent mix-blend-difference' : 'bg-ink group-hover:bg-[var(--ink-hover)]'}`}
    >
      <span className="relative">
        {children}
        <span
          aria-hidden
          className={`motion-ui absolute -bottom-[3px] left-0 h-px w-full origin-left bg-paper transition-transform duration-200 ease-brand
            ${active ? 'scale-x-100' : 'scale-x-0 group-hover:scale-x-100 group-focus-visible:scale-x-100'}`}
        />
      </span>
    </span>
  )
}

export function NavChip({ to, children, end, blend, badge }:
  { to: string; children: ReactNode; end?: boolean; blend?: boolean; badge?: ReactNode }) {
  return (
    <NavLink to={to} end={end} className="group inline-flex min-h-12 min-w-12 items-center justify-center">
      {({ isActive }) => (
        <span className="inline-flex items-center">
          <ChipFace active={isActive} blend={blend}>{children}</ChipFace>
          {badge}
        </span>
      )}
    </NavLink>
  )
}

export function ChipButton({ active = false, children, blend, ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; blend?: boolean }) {
  return (
    <button type="button" className="group inline-flex min-h-12 min-w-12 items-center justify-center" {...rest}>
      <ChipFace active={active} blend={blend}>{children}</ChipFace>
    </button>
  )
}

/** Small cyan square with ink digits, beside the REVIEW chip. */
export function CountBadge({ count, label }: { count: number; label: string }) {
  if (count <= 0) return null
  return (
    <span aria-label={label} className="ml-1 inline-flex h-[22px] min-w-[22px] items-center justify-center bg-cyan px-1 t-label text-ink tabular-nums">
      {count}
    </span>
  )
}

/**
 * Segmented choice (bill kind, Paid/Credit, CREATE/JOIN). Selected = ink; unselected = ink hairline.
 * On dark panels the roles invert (paper fill / white-40% hairline) so the choice stays visible.
 */
export function SegmentChip({ selected, dark = false, children, className = '', ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { selected: boolean; dark?: boolean }) {
  const tone = dark
    ? selected ? 'bg-paper text-ink border border-paper' : 'text-paper border border-[var(--hairline-dark)] hover:border-paper'
    : selected ? 'bg-ink text-paper border border-ink' : 'text-ink border border-ink hover:bg-bone'
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={`motion-ui min-h-12 px-4 t-label transition-colors duration-200 ease-brand ${tone} ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}
