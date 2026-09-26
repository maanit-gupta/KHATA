import type { Session } from '@supabase/supabase-js'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, type Me } from '../lib/api'
import { DEMO_SESSION, isDemo } from '../lib/demo'
import { supabase } from '../lib/supabase'

/** undefined = still restoring the session from storage. */
const SessionContext = createContext<Session | null | undefined>(undefined)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const qc = useQueryClient()
  useEffect(() => {
    if (isDemo()) {
      setSession(DEMO_SESSION)
      return
    }
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      if (!s) qc.removeQueries({ queryKey: ['me'] })
    })
    return () => data.subscription.unsubscribe()
  }, [qc])
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>
}

export function useSession() {
  return useContext(SessionContext)
}

/** GET /me for the signed-in user. shop === null means onboarding isn't finished. */
export function useMe() {
  const session = useSession()
  return useQuery({
    queryKey: ['me', session?.user.id],
    queryFn: () => api<Me>('/me'),
    enabled: !!session,
    staleTime: 60_000,
  })
}
