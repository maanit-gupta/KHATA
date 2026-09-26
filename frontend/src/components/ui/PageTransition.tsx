import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useState, type ReactNode } from 'react'
import { Routes, useLocation } from 'react-router'
import { useReducedMotion } from '../../hooks/useReducedMotion'

const EASE = [0.65, 0, 0.35, 1] as const
const COVER_MS = 250

/**
 * Page transitions everywhere (DESIGN.md §8): a --bone cover fades in over 250ms, the route
 * changes under it, then the cover fades out while the new content rises 20px.
 * Reduced motion: the route swaps instantly.
 */
export function TransitionRoutes({ children }: { children: ReactNode }) {
  const location = useLocation()
  const reduced = useReducedMotion()
  const [shown, setShown] = useState(location)
  const [phase, setPhase] = useState<'idle' | 'cover' | 'reveal'>('idle')

  useEffect(() => {
    if (location.pathname === shown.pathname) {
      if (location !== shown) setShown(location) // same page (query/hash/state): no cover
      return
    }
    if (reduced) {
      setShown(location)
      return
    }
    setPhase('cover')
    const id = window.setTimeout(() => {
      setShown(location)
      setPhase('reveal')
      window.scrollTo(0, 0)
    }, COVER_MS)
    return () => window.clearTimeout(id)
  }, [location, shown, reduced])

  return (
    <>
      {/* CSS animation with fill-mode `backwards`: once the rise ends no transform remains, so
          position:fixed headers inside the page stay pinned to the viewport. */}
      <div key={shown.pathname} className={phase === 'reveal' ? 'route-rise' : undefined}>
        <Routes location={shown}>{children}</Routes>
      </div>
      <AnimatePresence>
        {phase === 'cover' && (
          <motion.div
            aria-hidden
            className="fixed inset-0 z-[60] bg-bone"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: COVER_MS / 1000, ease: EASE }}
          />
        )}
      </AnimatePresence>
    </>
  )
}
