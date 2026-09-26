import type { ReactNode } from 'react'
import { Outlet } from 'react-router'
import { AppNav } from '../components/ui/AppNav'
import { Header } from '../components/ui/Header'
import { H2 } from '../components/ui/H2'
import { Row } from '../components/ui/Row'
import { supabase } from '../lib/supabase'
import { t } from '../strings/en'

/** In-app chrome: --bone header with the nav chips; screens render below it. */
export function AppShell() {
  return (
    <div className="min-h-dvh bg-paper">
      <Header home="/app">
        <AppNav />
      </Header>
      <main className="pt-14">
        <Outlet />
      </main>
    </div>
  )
}

/** Mobile: single column. ≥900px: title (and actions) in the left 1/3, content in the right 2/3. */
export function Screen({ title, children }: { title: readonly string[]; children?: ReactNode }) {
  return (
    <div className="grid gap-8 gutter-x py-10 app:grid-cols-3 app:py-16">
      <H2 lines={title} as="h1" />
      {children && <div className="app:col-span-2">{children}</div>}
    </div>
  )
}

export function Placeholder({ title }: { title: readonly string[] }) {
  return <Screen title={title} />
}

/** Settings is a placeholder too, plus LOG OUT (DESIGN.md §6.12) so sessions can be ended. */
export function SettingsPlaceholder() {
  return (
    <Screen title={t.screens.settings}>
      <div className="border-b border-ink">
        <Row status="unselected" onClick={() => supabase.auth.signOut()}>
          <span className="t-label-lg">{t.screens.logOut}</span>
        </Row>
      </div>
    </Screen>
  )
}
