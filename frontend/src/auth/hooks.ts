import { useQuery } from '@tanstack/react-query'
import { useContext } from 'react'
import { api, type Me } from '../lib/api'
import { SessionContext } from './context'

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
