import type { Session } from '@supabase/supabase-js'
import { createContext } from 'react'

/** undefined = still restoring the session from storage. */
export const SessionContext = createContext<Session | null | undefined>(undefined)
