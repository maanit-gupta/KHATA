import { Suspense, type ReactNode } from 'react'
import { Outlet } from 'react-router'
import { AppNav } from '../components/ui/AppNav'
import { Header } from '../components/ui/Header'
import { H2 } from '../components/ui/H2'
import { useReview } from '../lib/review'

/** In-app chrome: --bone header with the nav chips; screens render below it. */
export function AppShell() {
  const review = useReview()
  return (
    <div className="min-h-dvh bg-paper">
      <Header home="/app">
        <AppNav reviewCount={review.data?.count ?? 0} />
      </Header>
      <main className="pt-14">
        <Suspense fallback={null}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  )
}

/** Mobile: single column. ≥900px: title (and actions) in the left 1/3, content in the right 2/3. */
export function Screen({ title, children }: { title: readonly string[]; children?: ReactNode }) {
  return (
    <div className="grid gap-8 gutter-x py-10 app:grid-cols-3 app:py-16">
      <H2 lines={title} as="h1" />
      {children && <div className="min-w-0 app:col-span-2">{children}</div>}
    </div>
  )
}
