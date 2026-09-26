import type { ReactNode } from 'react'

/**
 * A small show/hide block (GOAL_2.0 P1.3 "WHAT I HEARD" / "WHAT I READ"). Native <details>, so it
 * works from the keyboard and with screen readers without script. The marker is a square: an
 * outline when closed, solid when open (DESIGN.md §1: squares are the only markers).
 */
export function Disclosure({ label, children, dark = false, testId }:
  { label: string; children: ReactNode; dark?: boolean; testId?: string }) {
  const line = dark ? 'border-[var(--hairline-dark)]' : 'border-ink'
  const open = dark ? 'group-open:bg-paper' : 'group-open:bg-ink'
  return (
    <details className="group" data-testid={testId}>
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 t-label [&::-webkit-details-marker]:hidden">
        <span aria-hidden className={`inline-block size-[10px] shrink-0 border ${dark ? 'border-paper' : 'border-ink'} ${open}`} />
        {label}
      </summary>
      <div className={`border-t ${line} pt-3 pb-1`}>{children}</div>
    </details>
  )
}
