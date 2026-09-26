import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ping } from '../lib/api'
import { setOffline, useOffline } from '../lib/connectivity'
import { t } from '../strings/en'
import { Button } from './ui/Button'
import { H2 } from './ui/H2'

/** DESIGN.md §6.13: full-screen --ink overlay, white two-line H2, RETRY. */
export function OfflineOverlay() {
  const offline = useOffline()
  const qc = useQueryClient()
  const [checking, setChecking] = useState(false)
  const [failed, setFailed] = useState(false)
  const button = useRef<HTMLButtonElement>(null)

  const retry = useCallback(async () => {
    setChecking(true)
    const ok = navigator.onLine !== false && (await ping())
    setChecking(false)
    setFailed(!ok)
    if (ok) {
      setOffline(false)
      qc.invalidateQueries()
    }
  }, [qc])

  useEffect(() => {
    if (!offline) return
    button.current?.focus()
    const onOnline = () => { void retry() }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [offline, retry])

  if (!offline) return null
  return (
    <div role="alertdialog" aria-modal="true" aria-labelledby="offline-title" data-testid="offline"
      className="on-dark fixed inset-0 z-[80] flex flex-col justify-end bg-ink gutter-x pb-12 text-paper">
      <div className="flex max-w-[640px] flex-col gap-8">
        <div id="offline-title"><H2 lines={t.offline.heading} /></div>
        {failed && <p className="t-body-lg" role="status">{t.offline.still}</p>}
        <Button ref={button} variant="inverse" disabled={checking} onClick={retry}>{checking ? t.ledger.working : t.offline.retry}</Button>
      </div>
    </div>
  )
}
