import type { ReactNode } from 'react'

/** A box that scrolls sideways on its own (wide tables on a phone) while the page never does.
 * Focusable and labelled, so keyboard users can scroll it too (WCAG scrollable-region-focusable). */
export function ScrollBox({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return (
    <div role="region" aria-label={label} tabIndex={0} data-testid={testId} className="overflow-x-auto">
      {children}
    </div>
  )
}
