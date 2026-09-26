export type Status = 'confirmed' | 'pending' | 'voided' | 'selected' | 'unselected'

const SQUARE: Record<Status, string> = {
  confirmed: 'bg-ink',
  selected: 'bg-ink',
  pending: 'bg-cyan-deep',
  voided: 'border border-ink',
  unselected: 'border border-ink',
}
const ON_DARK: Record<Status, string> = {
  confirmed: 'bg-paper',
  selected: 'bg-paper',
  pending: 'bg-cyan-deep',
  voided: 'border border-paper',
  unselected: 'border border-[var(--hairline-dark)]',
}

/** The only status language (DESIGN.md §5): solid ink, cyan-deep, or an ink outline. */
export function StatusSquare({ status, size = 14, dark = false, className = '' }:
  { status: Status; size?: number; dark?: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block shrink-0 ${(dark ? ON_DARK : SQUARE)[status]} ${className}`}
      style={{ width: size, height: size }}
    />
  )
}
