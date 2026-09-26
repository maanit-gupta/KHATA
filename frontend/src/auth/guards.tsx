import { Navigate, Outlet } from 'react-router'
import { t } from '../strings/en'
import { useMe, useSession } from './session'

function Loading() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-bone">
      <p className="t-label text-muted" role="status">{t.errors.loading}</p>
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
export function RequireShop() {
  const session = useSession()
  const me = useMe()
  if (session === undefined) return <Loading />
  if (!session) return <Navigate to="/login" replace />
  if (me.isPending) return <Loading />
  if (me.isError) return <MeError message={me.error.message} />
  if (!me.data.shop) return <Navigate to="/onboarding" replace />
  return <Outlet />
}

/** /onboarding: needs a session and NO shop yet. */
export function RequireSessionWithoutShop() {
  const session = useSession()
  const me = useMe()
  if (session === undefined) return <Loading />
  if (!session) return <Navigate to="/login" replace />
  if (me.isPending) return <Loading />
  if (me.isError) return <MeError message={me.error.message} />
  if (me.data.shop) return <Navigate to="/app" replace />
  return <Outlet />
}

/** /login, /signup: signed-in users go straight to where they belong. */
export function PublicOnly() {
  const session = useSession()
  const me = useMe()
  if (session === undefined) return <Loading />
  if (!session) return <Outlet />
  if (me.isPending) return <Loading />
  if (me.isError) return <Outlet />
  return <Navigate to={me.data.shop ? '/app' : '/onboarding'} replace />
}
