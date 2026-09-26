import type { ReactNode } from 'react'

/**
 * Ink bar pinned to the bottom, full width, white uppercase text (DESIGN.md §5). `countdownMs`
 * draws the white top hairline shrinking 1→0 — linear, and kept under reduced motion (§6.5, §8).
 */
export function Toast({ children, action, countdownMs, inline = false }:
  { children: ReactNode; action?: ReactNode; countdownMs?: number; inline?: boolean }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`on-dark ${inline ? 'relative' : 'fixed inset-x-0 bottom-0 z-50'} flex min-h-14 items-center justify-between gap-4 bg-ink gutter-x text-paper`}
      style={inline ? undefined : { paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {countdownMs != null && (
        <span
          aria-hidden
          key={countdownMs}
          className="countdown absolute inset-x-0 top-0 h-px bg-paper"
          style={{ animationName: 'countdown-shrink', animationDuration: `${countdownMs}ms` }}
        />
      )}
      <span className="t-label py-4">{children}</span>
      {action}
    </div>
  )
}

/** The chip used inside a toast (e.g. UNDO): white hairline on ink. */
export function ToastAction({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex min-h-12 min-w-12 items-center justify-center">
      <span className="border border-paper px-[10px] py-[6px] t-label hover:bg-paper hover:text-ink">{children}</span>
    </button>
  )
}
