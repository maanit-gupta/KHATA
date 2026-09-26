import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { t } from '../../strings/en'

/**
 * Fixed 56px bar: uppercase wordmark top-left (no logo mark), nav chips on the right.
 * `transparent` over the landing hero; `bone` everywhere else (DESIGN.md §5).
 */
export function Header({ tone = 'bone', home = '/', children, fixed = true }:
  { tone?: 'bone' | 'transparent'; home?: string; children?: ReactNode; fixed?: boolean }) {
  return (
    <header
      className={`${fixed ? 'fixed inset-x-0 top-0 z-40' : 'relative'} flex h-14 items-center justify-between gutter-x
        ${tone === 'bone' ? 'bg-bone' : 'bg-transparent'}`}
    >
      <Link to={home} className="inline-flex min-h-12 items-center t-label-lg">
        {t.brand}
      </Link>
      <nav aria-label={t.nav.main} className="flex items-center gap-2">{children}</nav>
    </header>
  )
}
