import { useReveal } from './useReveal'

/** Landing sections reveal when 15% is in view, once per session (DESIGN.md §8). */
export function useSectionReveal(key: string) {
  return useReveal<HTMLElement>({ key: `landing-${key}`, observe: true })
}
