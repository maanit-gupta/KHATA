import { useQuery } from '@tanstack/react-query'
import { api } from './api'
import type { Entry, Party } from './ledger'
import type { Receipt } from './receipts'

export type ReviewRow =
  | { item: 'entry'; id: string; reason: string | null; created_at: string; detail: Entry | null }
  | { item: 'party'; id: string; reason: string | null; created_at: string; detail: Party | null }
  | { item: 'receipt'; id: string; reason: string | null; created_at: string; detail: (Receipt & { id: string }) | null }

/** GET /review. Also drives the count on the REVIEW nav chip. */
export const useReview = (enabled = true) =>
  useQuery({
    queryKey: ['review'],
    queryFn: () => api<{ rows: ReviewRow[]; count: number }>('/review'),
    enabled,
    staleTime: 30_000,
  })

export const renameParty = ({ id, name }: { id: string; name: string }) =>
  api<Party>(`/parties/${id}`, { method: 'PATCH', body: JSON.stringify({ display_name: name, needs_review: false }) })

export const keepParty = (id: string) =>
  api<Party>(`/parties/${id}`, { method: 'PATCH', body: JSON.stringify({ needs_review: false }) })

export const mergeParty = ({ id, into }: { id: string; into: string }) =>
  api<Party>(`/parties/${id}/merge`, { method: 'POST', body: JSON.stringify({ into_party_id: into }) })
