import type { Lang } from '../strings/en'

/** bulbul:v3 speakers (docs/sarvam-notes.md) minus `varun`, which is hidden (CLAUDE.md §9b).
 * Mirrors backend app/constants.py VOICES. */
export const VOICES = ['shubh', 'aditya', 'ritu', 'priya', 'neha', 'rahul', 'pooja', 'rohan', 'simran', 'kavya',
  'amit', 'dev', 'ishita', 'shreya', 'ratan', 'manan', 'sumit', 'roopa', 'kabir', 'aayan', 'ashutosh', 'advait',
  'anand', 'tanya', 'tarun', 'sunny', 'mani', 'gokul', 'vijay', 'shruti', 'suhani', 'mohit', 'kavitha', 'rehan',
  'soham', 'rupali'] as const

/** Used until the user picks one (CLAUDE.md §9b). */
export const DEFAULT_VOICE: Record<Lang, string> = {
  'ta-IN': 'ratan', 'hi-IN': 'shubh', 'en-IN': 'ratan', 'te-IN': 'shubh', 'kn-IN': 'shubh', 'ml-IN': 'shubh',
}

/** Sarvam's best-rated speakers per language (docs/sarvam-notes.md), listed first. */
export const RECOMMENDED: Record<Lang, string[]> = {
  'ta-IN': ['ratan', 'rohan', 'ishita', 'ritu'],
  'hi-IN': ['shubh', 'ashutosh', 'priya', 'suhani'],
  'en-IN': ['ratan', 'ishita'],
  'te-IN': ['shubh', 'ratan', 'neha', 'priya'],
  'kn-IN': ['shubh', 'ratan', 'neha', 'ishita'],
  'ml-IN': ['shubh', 'pooja'],
}

export function voicesFor(lang: Lang): string[] {
  const first = RECOMMENDED[lang] ?? []
  return [...first, ...VOICES.filter((v) => !first.includes(v))]
}
