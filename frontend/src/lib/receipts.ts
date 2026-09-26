import { useQuery } from '@tanstack/react-query'
import { api } from './api'

export type Kind = 'supplier' | 'customer' | 'expense'
export type Receipt = {
  receipt_id: string; status: 'queued' | 'processing' | 'done' | 'failed'; kind: Kind; settled: boolean | null
  vendor_name: string | null; bill_date: string | null; total_paise: number | null
  retried_in_english: boolean; error: string | null
  /** The bill's text as read (Digitise), and whether the total is printed on it (GOAL_2.0 P1.3, P2.4). */
  ocr_text?: string | null; total_check?: 'ok' | 'check' | null
  /** uploaded → reading → checking while the job runs (GOAL_2.0 P2.3). */
  stage?: 'uploaded' | 'reading' | 'checking' | null; file_type?: 'image' | 'pdf'; created_at?: string
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
