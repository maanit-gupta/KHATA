import { lazy, Suspense, useEffect } from 'react'
import { Route } from 'react-router'
import { PublicOnly, RequireSessionWithoutShop, RequireShop } from './auth/guards'
import { TransitionRoutes } from './components/ui/PageTransition'
import { AppShell } from './screens/AppShell'
import { EntryScreen } from './screens/EntryScreen'
import { ReviewScreen } from './screens/ReviewScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { AboutScreen } from './screens/AboutScreen'
import { AuthScreen } from './screens/AuthScreen'
import { LedgerScreen } from './screens/LedgerScreen'
import { PartiesScreen, PartyDetailScreen } from './screens/PartiesScreen'
import { ScanScreen } from './screens/ScanScreen'
import { OnboardingScreen } from './screens/OnboardingScreen'
import { enterDemo } from './lib/demo'
import { t } from './strings/en'

// /dev/ui exists only in dev: Vite replaces import.meta.env.DEV with false in production builds,
// so these imports are dead code and the gallery is not bundled.
const LandingScreen = lazy(() => import('./screens/LandingScreen'))

const DevUI = import.meta.env.DEV ? lazy(() => import('./dev/DevUI')) : null
const DevTransition = import.meta.env.DEV
  ? lazy(() => import('./dev/DevUI').then((m) => ({ default: m.DevTransitionTarget })))
  : null

/** /demo reached by an in-app link (a full page load is handled in main.tsx before React). */
function DemoEntry() {
  useEffect(() => { enterDemo('/app') }, [])
  return null
}

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
        <Route path="/" element={<LandingScreen />} />
        <Route path="/about" element={<AboutScreen />} />
        <Route path="/demo" element={<DemoEntry />} />
        <Route element={<PublicOnly />}>
          <Route path="/login" element={<AuthScreen mode="login" />} />
          <Route path="/signup" element={<AuthScreen mode="signup" />} />
        </Route>
        <Route element={<RequireSessionWithoutShop />}>
          <Route path="/onboarding" element={<OnboardingScreen />} />
        </Route>
        <Route element={<RequireShop />}>
          <Route path="/app" element={<AppShell />}>
            <Route index element={<LedgerScreen />} />
            <Route path="parties" element={<PartiesScreen />} />
            <Route path="parties/:id" element={<PartyDetailScreen />} />
            <Route path="review" element={<ReviewScreen />} />
            <Route path="entries/:id" element={<EntryScreen />} />
            <Route path="scan" element={<ScanScreen />} />
            <Route path="settings" element={<SettingsScreen />} />
          </Route>
        </Route>
        {DevUI && <Route path="/dev/ui" element={<DevUI />} />}
        {DevTransition && <Route path="/dev/ui/transition" element={<DevTransition />} />}
        <Route path="*" element={<NotFound />} />
      </TransitionRoutes>
    </Suspense>
  )
}
