import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { SessionProvider } from './auth/session'
import './index.css'
import { keepFocusedFieldVisible } from './lib/mobile'
import { unlockAudioOnFirstTap } from './lib/player'
import { Root } from './Root'
import { loadUiLang, savedUiLang } from './strings'

// Data stays fresh for 30 s, so going back to the Ledger (or any screen) shows the cached lists at
// once instead of refetching everything. Every write invalidates what it touches
// (lib/ledger.ts useLedgerMutation), so the cache never hides a change made in this app.
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000, gcTime: 10 * 60_000 } },
})

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

keepFocusedFieldVisible()
unlockAudioOnFirstTap()

// Before anyone signs in, use the language this device used last (the login page included).
loadUiLang(savedUiLang()).catch(() => {}).finally(render)
