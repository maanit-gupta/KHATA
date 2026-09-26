import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api'

export type EntryType = 'credit_given' | 'payment_received' | 'cash_sale' | 'purchase_credit' | 'purchase_paid' | 'payment_made' | 'expense'
export const ENTRY_TYPES: EntryType[] = ['credit_given', 'payment_received', 'cash_sale', 'purchase_credit', 'purchase_paid', 'payment_made', 'expense']
export const NO_PARTY_TYPES: EntryType[] = ['cash_sale', 'purchase_paid', 'expense']

export type Entry = {
  id: string; type: EntryType; amount_paise: number; status: 'pending' | 'confirmed' | 'voided'
  party_id: string | null; party_name: string | null; note: string | null; occurred_on: string
  auto_saved: boolean; review_reason: string | null; source: string; created_at: string
}
export type Party = {
  party_id: string; display_name: string; kind: 'customer' | 'supplier'
  needs_review: boolean; balance_paise: number; last_activity: string | null
}
export type VoiceResult = {
  decision: 'auto' | 'confirm' | 'clarify'; entry: Entry | null; suggestion: string | null
  speech_text: string; audio_b64: string | null; voice_note_id: string; transcript_en: string
}

export const useEntries = () =>
  useQuery({ queryKey: ['entries'], queryFn: () => api<{ entries: Entry[] }>('/entries?limit=20').then((r) => r.entries) })

export const useParties = () =>
  useQuery({ queryKey: ['parties'], queryFn: () => api<{ parties: Party[] }>('/parties').then((r) => r.parties) })

export const useParty = (id: string) =>
  useQuery({ queryKey: ['party', id], queryFn: () => api<{ party: Party; entries: Entry[] }>(`/parties/${id}`) })

/** Any ledger write invalidates entries and balances. */
export function useLedgerMutation<A, R>(fn: (arg: A) => Promise<R>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['entries'] })
      qc.invalidateQueries({ queryKey: ['parties'] })
      qc.invalidateQueries({ queryKey: ['party'] })
    },
  })
}

export const confirmEntry = (id: string) => api<Entry>(`/entries/${id}/confirm`, { method: 'POST' })
export const voidEntry = (id: string) => api<Entry>(`/entries/${id}/void`, { method: 'POST' })

export function playB64(b64: string | null) {
  if (!b64) return
  new Audio(`data:audio/mpeg;base64,${b64}`).play().catch(() => undefined)
}
