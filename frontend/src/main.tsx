import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { App } from './App'
import { SessionProvider } from './auth/session'
import { enterDemo } from './lib/demo'
import './index.css'

// /demo is a shareable one-click link into demo mode (see lib/demo.ts).
if (window.location.pathname === '/demo') enterDemo('/app')

// Data stays fresh for 30 s, so going back to the Ledger (or any screen) shows the cached lists at
// once instead of refetching everything. Every write invalidates what it touches
// (lib/ledger.ts useLedgerMutation), so the cache never hides a change made in this app.
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000, gcTime: 10 * 60_000 } },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </SessionProvider>
    </QueryClientProvider>
  </StrictMode>,
)
