import type { ReactNode } from 'react'

/**
 * Landing motion (DESIGN.md §8): IntersectionObserver at 15%, no bounce, var(--ease).
 * A section rises 40px and fades in over 700ms; its heading goes from --muted at 40% opacity to
 * ink (or white) over 600ms. CSS transitions with `motion-ui`, so reduced motion makes them
 * instant (and useReveal starts revealed).
 */
export function Rise({ revealed, children, className = '' }: { revealed: boolean; children: ReactNode; className?: string }) {
  return (
    <div className={`motion-ui transition-[transform,opacity] duration-700 ease-brand ${revealed ? 'translate-y-0 opacity-100' : 'translate-y-10 opacity-0'} ${className}`}>
      {children}
    </div>
  )
}

export function RevealHeading({ lines, revealed, dark = false, as: Tag = 'h2', className = 't-h2', id }:
  { lines: readonly string[]; revealed: boolean; dark?: boolean; as?: 'h1' | 'h2'; className?: string; id?: string }) {
  const done = dark ? 'text-paper' : 'text-ink'
  return (
    <Tag id={id} className={`motion-ui transition-[color,opacity] duration-[600ms] ease-brand ${revealed ? `${done} opacity-100` : 'text-muted opacity-40'} ${className}`}>
      {lines[0]}
      {lines[1] !== undefined && <><br />{lines[1]}</>}
    </Tag>
  )
}
