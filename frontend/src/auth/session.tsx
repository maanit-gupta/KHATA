import type { Session } from '@supabase/supabase-js'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type ReactNode } from 'react'
import { DEMO_SESSION, isDemo } from '../lib/demo'
import { supabase } from '../lib/supabase'
import { SessionContext } from './context'

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(() => (isDemo() ? DEMO_SESSION : undefined))
  const qc = useQueryClient()
  useEffect(() => {
    if (isDemo()) return
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      if (!s) qc.removeQueries({ queryKey: ['me'] })
    })
    return () => data.subscription.unsubscribe()
  }, [qc])
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>
}
