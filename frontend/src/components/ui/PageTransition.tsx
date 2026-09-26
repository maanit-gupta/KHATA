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
  const [risen, setRisen] = useState(false)
  const newPage = location.pathname !== shown.pathname

  // Same page (query/hash/state), or reduced motion: swap during render, no cover.
  if (location !== shown && (!newPage || reduced)) setShown(location)
  const covering = newPage && !reduced

  useEffect(() => {
    if (!covering) return
    const id = window.setTimeout(() => {
      setShown(location)
      setRisen(true)
      window.scrollTo(0, 0)
    }, COVER_MS)
    return () => window.clearTimeout(id)
  }, [covering, location])

  return (
    <>
      {/* CSS animation with fill-mode `backwards`: once the rise ends no transform remains, so
          position:fixed headers inside the page stay pinned to the viewport. */}
      <div key={shown.pathname} className={risen && !reduced ? 'route-rise' : undefined}>
        <Routes location={shown}>{children}</Routes>
      </div>
      <AnimatePresence>
        {covering && (
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
