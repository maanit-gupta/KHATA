import { useQuery } from '@tanstack/react-query'
import { api } from './api'

export type Kind = 'supplier' | 'customer' | 'expense'
export type Receipt = {
  receipt_id: string; status: 'queued' | 'processing' | 'done' | 'failed'; kind: Kind; settled: boolean | null
  vendor_name: string | null; bill_date: string | null; total_paise: number | null
  retried_in_english: boolean; error: string | null
}

const POLL_MS = 2000 // CLAUDE.md §6.3: the frontend polls GET /receipts/{id} every 2 s

/** Polls a receipt every 2 s until OCR finishes (done or failed). */
export function useReceipt(id: string | null) {
  return useQuery({
    queryKey: ['receipt', id],
    queryFn: () => api<Receipt>(`/receipts/${id}`),
    enabled: !!id,
    refetchInterval: (q) => (q.state.data && ['done', 'failed'].includes(q.state.data.status) ? false : POLL_MS),
  })
}
