import { useReducedMotion as useFramerReducedMotion } from 'framer-motion'

/** true when the OS asks for reduced motion: no ripple, no parallax, reveals are instant. */
export function useReducedMotion(): boolean {
  return useFramerReducedMotion() ?? false
}
