import type { QueryClient } from '@tanstack/react-query'
import { fetchDashboard } from './dashboard'

/**
 * Start a screen's data and code while GET /me is still in flight (the shop guard waits for it), so
 * the two round trips overlap instead of queueing (GOAL_2.0 P6: the dashboard in under 1.5 s).
 * A request made before we know there is a shop just fails quietly; the guard redirects anyway.
 */
export function prefetchFor(pathname: string, qc: QueryClient) {
  if (pathname === '/app/dashboard') {
    void qc.prefetchQuery({ queryKey: ['dashboard'], queryFn: fetchDashboard, staleTime: 30_000 })
    void import('../screens/DashboardScreen')
    void import('../components/dashboard/Charts')
  }
}
