import { t } from '../../strings'

/**
 * GOAL_2.0 P8: loading placeholders. Flat mist blocks on hairline rows, no shimmer or gradient
 * (DESIGN.md: flat surfaces). Announced once as "Loading…" to screen readers.
 */
export function SkeletonRows({ rows = 4, testId = 'skeleton' }: { rows?: number; testId?: string }) {
  return (
    <div role="status" aria-label={t.errors.loading} aria-busy="true" className="border-b border-ink" data-testid={testId}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} aria-hidden className="grid grid-cols-[24px_1fr_auto] items-center gap-3 border-t border-ink py-4">
          <span className="size-4 bg-mist" />
          <span className="h-4 bg-mist" style={{ width: `${70 - ((i * 17) % 35)}%` }} />
          <span className="h-4 w-16 bg-mist" />
        </div>
      ))}
    </div>
  )
}

export function SkeletonBlock({ className = '', testId = 'skeleton' }: { className?: string; testId?: string }) {
  return <div role="status" aria-label={t.errors.loading} aria-busy="true" className={`bg-mist ${className}`} data-testid={testId} />
}
