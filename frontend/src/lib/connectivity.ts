import { useSyncExternalStore } from 'react'

/**
 * Offline state for the full-screen overlay (CLAUDE.md §8, DESIGN.md §6.13): set when the browser
 * says it's offline or an API fetch fails outright; cleared when RETRY reaches the server. There
 * is no queuing: while offline nothing is saved.
 */
let offline = typeof navigator !== 'undefined' && navigator.onLine === false
const listeners = new Set<() => void>()

export function setOffline(value: boolean) {
  if (value === offline) return
  offline = value
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function useOffline(): boolean {
  return useSyncExternalStore(subscribe, () => offline, () => false)
}

if (typeof window !== 'undefined') {
  window.addEventListener('offline', () => setOffline(true))
}
