import { useEffect, useRef, useState } from 'react'
import { useReducedMotion } from './useReducedMotion'

// Keys that have already played their reveal this session. The app's rule (DESIGN.md §8):
// rows line-draw once, on the first load of a screen — never on re-render, refetch, or revisit.
const played = new Set<string>()

type Options = {
  /** Stable id for the screen/section. Once played, later mounts render instantly. */
  key: string
  /** Landing-page style: wait until 15% is in view. App screens reveal on mount. */
  observe?: boolean
}

/**
 * Run-once reveal. `revealed` flips true once; `animate` says whether to actually animate
 * (false for reduced motion or a key that already played).
 */
export function useReveal<T extends Element = HTMLDivElement>({ key, observe = false }: Options) {
  const reduced = useReducedMotion()
  const alreadyPlayed = played.has(key)
  const [animate] = useState(() => !reduced && !alreadyPlayed)
  const [revealed, setRevealed] = useState(() => !animate || !observe)
  const ref = useRef<T>(null)

  useEffect(() => {
    played.add(key)
  }, [key])

  useEffect(() => {
    if (revealed || !ref.current) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setRevealed(true)
          io.disconnect()
        }
      },
      { threshold: 0.15 },
    )
    io.observe(ref.current)
    return () => io.disconnect()
  }, [revealed])

  return { ref, revealed, animate }
}

/** Test/dev helper: let /dev/ui replay reveals. */
export function resetReveals(): void {
  played.clear()
}
