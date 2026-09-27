import { Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Outlet } from 'react-router'
import { useMe } from '../auth/hooks'
import { AppNav } from '../components/ui/AppNav'
import { H2 } from '../components/ui/H2'
import { Header } from '../components/ui/Header'
import { Toast } from '../components/ui/Toast'
import { useLiveSync } from '../lib/live'
import { useMembers } from '../lib/members'
import { useReview } from '../lib/review'

const LIVE_TOAST_MS = 4000

/** In-app chrome: --bone header with the nav chips; screens render below it. Keeps the shop in
 * live sync with other members (GOAL_2.0 P4.2) and says when someone else adds an entry. */
export function AppShell() {
  const review = useReview()
  const me = useMe()
  useMembers() // names for "Added by" and the live toast
  const [liveToast, setLiveToast] = useState<string | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const announce = useCallback((text: string) => {
    window.clearTimeout(timer.current)
    setLiveToast(text)
    timer.current = window.setTimeout(() => setLiveToast(null), LIVE_TOAST_MS)
  }, [])
  useEffect(() => () => window.clearTimeout(timer.current), [])
  useLiveSync(me.data?.membership?.shop_id, me.data?.user.id, announce)
  return (
    <div className="min-h-dvh bg-paper">
      <div className="no-print">
        <Header home="/app">
          <AppNav reviewCount={review.data?.count ?? 0} />
        </Header>
      </div>
      <main className="pt-14 print:pt-0">
        <Suspense fallback={null}>
          <Outlet />
        </Suspense>
      </main>
      {liveToast && <Toast testId="live-toast">{liveToast}</Toast>}
    </div>
  )
}

/** Mobile: single column. ≥900px: title (and actions) in the left 1/3, content in the right 2/3.
 * `wide` puts the content under the title across the full width, for screens made of wide tables
 * (the dashboard). */
export function Screen({ title, children, wide = false }: { title: readonly string[]; children?: ReactNode; wide?: boolean }) {
  return (
    <div className={`grid gap-8 gutter-x py-10 app:py-16 ${wide ? '' : 'app:grid-cols-3'}`}>
      <H2 lines={title} as="h1" />
      {children && <div className={`min-w-0 ${wide ? '' : 'app:col-span-2'}`}>{children}</div>}
    </div>
  )
}
