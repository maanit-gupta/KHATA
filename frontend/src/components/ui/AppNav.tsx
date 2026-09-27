import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { NavLink } from 'react-router'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { t } from '../../strings'
import { ChipButton, CountBadge, NavChip } from './Chip'

const ITEMS = [
  { to: '/app', key: 'home', end: true },
  { to: '/app/ledger', key: 'ledger' },
  { to: '/app/dashboard', key: 'dashboard' },
  { to: '/app/parties', key: 'parties' },
  { to: '/app/review', key: 'review', review: true },
  { to: '/app/settings', key: 'settings' },
] as const

/** HOME / LEDGER / DASHBOARD / PARTIES / REVIEW / SETTINGS (GOAL_2.0 P3.1, P6). Below 900px: one MENU chip → full-screen ink overlay. */
export function AppNav({ reviewCount = 0 }: { reviewCount?: number }) {
  const [open, setOpen] = useState(false)
  const reduced = useReducedMotion()
  const firstLink = useRef<HTMLAnchorElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    firstLink.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open])

  const badge = <CountBadge count={reviewCount} label={t.nav.reviewCount(reviewCount)} />
  return (
    <>
      <div className="hidden items-center gap-2 app:flex">
        {ITEMS.map((i) => (
          <NavChip key={i.to} to={i.to} end={'end' in i} badge={'review' in i ? badge : undefined}>
            {t.nav[i.key]}
          </NavChip>
        ))}
      </div>
      <div className="flex items-center app:hidden">
        <ChipButton aria-expanded={open} aria-controls="app-menu" onClick={() => setOpen(true)}>
          {t.nav.menu}
        </ChipButton>
        {reviewCount > 0 && badge}
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            id="app-menu"
            role="dialog"
            aria-modal="true"
            aria-label={t.nav.main}
            className="on-dark fixed inset-0 z-50 flex flex-col bg-ink text-paper app:hidden"
            initial={reduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.65, 0, 0.35, 1] }}
          >
            <div className="flex h-14 items-center justify-between gutter-x">
              <span className="t-label-lg">{t.brand}</span>
              <button type="button" onClick={() => setOpen(false)} className="inline-flex min-h-12 min-w-12 items-center justify-center">
                <span className="border border-paper px-[10px] py-[6px] t-label">{t.nav.close}</span>
              </button>
            </div>
            <ul className="flex flex-1 flex-col justify-end gap-1 gutter-x pb-10">
              {ITEMS.map((i, idx) => (
                <li key={i.to}>
                  <NavLink
                    ref={idx === 0 ? firstLink : undefined}
                    to={i.to}
                    end={'end' in i}
                    onClick={() => setOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-3 py-1 uppercase leading-[0.95] tracking-[-0.02em] text-[clamp(48px,14vw,96px)] ${isActive ? 'underline decoration-2 underline-offset-8' : ''}`
                    }
                  >
                    {t.nav[i.key]}
                    {'review' in i && reviewCount > 0 && (
                      <span className="inline-flex size-10 items-center justify-center bg-cyan t-label-lg text-ink">{reviewCount}</span>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
