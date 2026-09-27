import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode, useEffect, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { App } from './App'
import { useMe } from './auth/hooks'
import { SessionProvider } from './auth/session'
import './index.css'
import { isLang, loadUiLang, savedUiLang, subscribeUiLang, uiLang } from './strings'

// Data stays fresh for 30 s, so going back to the Ledger (or any screen) shows the cached lists at
// once instead of refetching everything. Every write invalidates what it touches
// (lib/ledger.ts useLedgerMutation), so the cache never hides a change made in this app.
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000, gcTime: 10 * 60_000 } },
})

/**
 * GOAL_2.0 P5.2: the screens follow the signed-in member's on-screen language (ui_lang, else the
 * language they speak in). A change re-mounts the app under the new strings; the query cache and
 * the URL survive it.
 */
function Root() {
  const me = useMe()
  const m = me.data?.membership
  const wanted = m ? (m.ui_lang ?? m.lang) : null
  useEffect(() => {
    if (isLang(wanted)) loadUiLang(wanted).catch(() => { /* chunk failed: stay in the current language */ })
  }, [wanted])
  const lang = useSyncExternalStore(subscribeUiLang, uiLang)
  return <App key={lang} />
}

function render() {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <BrowserRouter>
            <Root />
          </BrowserRouter>
        </SessionProvider>
      </QueryClientProvider>
    </StrictMode>,
  )
}

// Before anyone signs in, use the language this device used last (the login page included).
loadUiLang(savedUiLang()).catch(() => {}).finally(render)
