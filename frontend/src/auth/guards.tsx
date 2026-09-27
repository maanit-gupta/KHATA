import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router'
import { prefetchFor } from '../lib/prefetch'
import { t } from '../strings'
import { useMe, useSession } from './hooks'

const WAKING_AFTER_MS = 3000 // the free Render instance sleeps; its first answer can be slow

function Loading() {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    const id = window.setTimeout(() => setSlow(true), WAKING_AFTER_MS)
    return () => window.clearTimeout(id)
  }, [])
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-bone gutter-x text-center" role="status" aria-live="polite">
      <p className="t-label">{slow ? t.errors.waking : t.errors.loading}</p>
      {slow && <p className="max-w-sm t-body">{t.errors.wakingHelp}</p>}
    </div>
  )
}

function MeError({ message }: { message: string }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-bone gutter-x">
      <p className="t-body-lg" role="alert">{message}</p>
    </div>
  )
}

/** /app/*: needs a session AND a shop membership (CLAUDE.md §7). */
/** To /login, carrying where to come back to after logging in again (GOAL_2.0 P8): the page the
 * session ended on. The state object is memoised: <Navigate> re-navigates whenever it changes. */
function ToLogin({ from }: { from: string }) {
  const state = useMemo(() => ({ from }), [from])
  return <Navigate to="/login" replace state={state} />
}
const toLogin = (location: { pathname: string; search: string }) => <ToLogin from={location.pathname + location.search} />

export function RequireShop() {
  const session = useSession()
  const me = useMe()
  const qc = useQueryClient()
  const location = useLocation()
  const landedOn = useRef(location.pathname) // the page we landed on; later navigations load normally
  const hasSession = !!session
  useEffect(() => {
    if (hasSession) prefetchFor(landedOn.current, qc)
  }, [hasSession, qc])
  if (session === undefined) return <Loading />
  if (!session) return toLogin(location)
  if (me.isPending) return <Loading />
  if (me.isError) return <MeError message={me.error.message} />
  if (!me.data.shop) return <Navigate to="/onboarding" replace />
  return <Outlet />
}

/** /onboarding: needs a session and NO shop yet. */
export function RequireSessionWithoutShop() {
  const session = useSession()
  const me = useMe()
  const location = useLocation()
  if (session === undefined) return <Loading />
  if (!session) return toLogin(location)
  if (me.isPending) return <Loading />
  if (me.isError) return <MeError message={me.error.message} />
  if (me.data.shop) return <Navigate to="/app" replace />
  return <Outlet />
}

/** /login, /signup: signed-in users go straight to where they belong. */
export function PublicOnly() {
  const session = useSession()
  const me = useMe()
  const from = (useLocation().state as { from?: string } | null)?.from
  if (session === undefined) return <Loading />
  if (!session) return <Outlet />
  if (me.isPending) return <Loading />
  if (me.isError) return <Outlet />
  if (!me.data.shop) return <Navigate to="/onboarding" replace />
  return <Navigate to={from?.startsWith('/app') ? from : '/app'} replace />
}
