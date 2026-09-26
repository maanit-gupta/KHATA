import { lazy, Suspense } from 'react'
import { Route } from 'react-router'
import { PublicOnly, RequireSessionWithoutShop, RequireShop } from './auth/guards'
import { OfflineOverlay } from './components/OfflineOverlay'
import { TransitionRoutes } from './components/ui/PageTransition'
import { AppShell } from './screens/AppShell'
import { AuthScreen } from './screens/AuthScreen'
import { LedgerScreen } from './screens/LedgerScreen'
import { t } from './strings/en'

// /dev/ui exists only in dev: Vite replaces import.meta.env.DEV with false in production builds,
// so these imports are dead code and the gallery is not bundled.
// Ledger, log-in and the app shell ship in the main chunk; everything else loads on first visit
// (GOAL.md P8.3). Each lazy screen is its own small chunk.
const LandingScreen = lazy(() => import('./screens/LandingScreen'))
const AboutScreen = lazy(() => import('./screens/AboutScreen').then((m) => ({ default: m.AboutScreen })))
const OnboardingScreen = lazy(() => import('./screens/OnboardingScreen').then((m) => ({ default: m.OnboardingScreen })))
const PartiesScreen = lazy(() => import('./screens/PartiesScreen').then((m) => ({ default: m.PartiesScreen })))
const PartyDetailScreen = lazy(() => import('./screens/PartiesScreen').then((m) => ({ default: m.PartyDetailScreen })))
const ReviewScreen = lazy(() => import('./screens/ReviewScreen').then((m) => ({ default: m.ReviewScreen })))
const EntryScreen = lazy(() => import('./screens/EntryScreen').then((m) => ({ default: m.EntryScreen })))
const ScanScreen = lazy(() => import('./screens/ScanScreen').then((m) => ({ default: m.ScanScreen })))
const SettingsScreen = lazy(() => import('./screens/SettingsScreen').then((m) => ({ default: m.SettingsScreen })))

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
        <Route path="/" element={<LandingScreen />} />
        <Route path="/about" element={<AboutScreen />} />
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
      <OfflineOverlay />
    </Suspense>
  )
}
