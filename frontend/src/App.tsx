import { lazy, Suspense } from 'react'
import { Navigate, Route } from 'react-router'
import { PublicOnly, RequireSessionWithoutShop, RequireShop } from './auth/guards'
import { TransitionRoutes } from './components/ui/PageTransition'
import { AppShell, Placeholder, SettingsPlaceholder } from './screens/AppShell'
import { AuthScreen } from './screens/AuthScreen'
import { OnboardingScreen } from './screens/OnboardingScreen'
import { t } from './strings/en'

// /dev/ui exists only in dev: Vite replaces import.meta.env.DEV with false in production builds,
// so these imports are dead code and the gallery is not bundled.
const DevUI = import.meta.env.DEV ? lazy(() => import('./dev/DevUI')) : null
const DevTransition = import.meta.env.DEV
  ? lazy(() => import('./dev/DevUI').then((m) => ({ default: m.DevTransitionTarget })))
  : null

function NotFound() {
  return (
    <div className="flex min-h-dvh items-center gutter-x">
      <p className="t-body-lg">{t.errors.notFound}</p>
    </div>
  )
}

export function App() {
  return (
    <Suspense fallback={null}>
      <TransitionRoutes>
        {/* The public landing page (DESIGN.md §7) is a later step; until then / goes to log in. */}
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route element={<PublicOnly />}>
          <Route path="/login" element={<AuthScreen mode="login" />} />
          <Route path="/signup" element={<AuthScreen mode="signup" />} />
        </Route>
        <Route element={<RequireSessionWithoutShop />}>
          <Route path="/onboarding" element={<OnboardingScreen />} />
        </Route>
        <Route element={<RequireShop />}>
          <Route path="/app" element={<AppShell />}>
            <Route index element={<Placeholder title={t.screens.ledger} />} />
            <Route path="parties" element={<Placeholder title={t.screens.parties} />} />
            <Route path="parties/:id" element={<Placeholder title={t.screens.partyDetail} />} />
            <Route path="review" element={<Placeholder title={t.screens.review} />} />
            <Route path="entries/:id" element={<Placeholder title={t.screens.entry} />} />
            <Route path="scan" element={<Placeholder title={t.screens.scan} />} />
            <Route path="settings" element={<SettingsPlaceholder />} />
          </Route>
        </Route>
        {DevUI && <Route path="/dev/ui" element={<DevUI />} />}
        {DevTransition && <Route path="/dev/ui/transition" element={<DevTransition />} />}
        <Route path="*" element={<NotFound />} />
      </TransitionRoutes>
    </Suspense>
  )
}
