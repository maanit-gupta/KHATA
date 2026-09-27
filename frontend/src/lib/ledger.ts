import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api'
import { formatPaise } from './money'
import { t } from '../strings'

export type EntryType = 'credit_given' | 'payment_received' | 'cash_sale' | 'purchase_credit' | 'purchase_paid' | 'payment_made' | 'expense'
export const ENTRY_TYPES: EntryType[] = ['credit_given', 'payment_received', 'cash_sale', 'purchase_credit', 'purchase_paid', 'payment_made', 'expense']
export const NO_PARTY_TYPES: EntryType[] = ['cash_sale', 'purchase_paid', 'expense']

export type Entry = {
  id: string; type: EntryType; amount_paise: number; status: 'pending' | 'confirmed' | 'voided'
  party_id: string | null; party_name: string | null; party_kind?: 'customer' | 'supplier' | null
  note: string | null; occurred_on: string; auto_saved: boolean; review_reason: string | null
  source: 'voice' | 'receipt' | 'manual'; created_at: string
  receipt_id?: string | null; voice_note_id?: string | null
  created_by?: string | null; confirmed_by?: string | null; added_by?: string | null; confirmed_by_name?: string | null
  expense_category?: string | null
}
/** GOAL_2.0 P6.6, as in backend app/constants.py. */
export const EXPENSE_CATEGORIES = ['stock_other', 'rent', 'electricity', 'wages', 'transport', 'repairs', 'misc'] as const
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]

export type Party = {
  party_id: string; display_name: string; kind: 'customer' | 'supplier'
  needs_review: boolean; balance_paise: number; last_activity: string | null
}
export type VoiceResult = {
  decision: 'auto' | 'confirm' | 'clarify'; entry: Entry | null; suggestion: string | null
  speech_text: string; audio_b64: string | null; voice_note_id: string; transcript_en: string | null
  /** Exactly what speech-to-text returned, unprocessed (GOAL_2.0 P1.3). */
  stt_raw?: string | null; speech_text_en?: string
}

export const useEntries = () =>
  useQuery({ queryKey: ['entries'], queryFn: () => api<{ entries: Entry[] }>('/entries?limit=20').then((r) => r.entries) })

export const fetchParties = () => api<{ parties: Party[] }>('/parties').then((r) => r.parties)

export const useParties = () => useQuery({ queryKey: ['parties'], queryFn: fetchParties })

export const useParty = (id: string) =>
  useQuery({ queryKey: ['party', id], queryFn: () => api<{ party: Party; entries: Entry[] }>(`/parties/${id}`) })

/** Any ledger write invalidates what can show its effect: entries, balances, review, the week. */
export function useLedgerMutation<A, R>(fn: (arg: A) => Promise<R>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      for (const key of ['entries', 'entry', 'ledger', 'parties', 'party', 'review', 'insights', 'dashboard', 'activity', 'report']) {
        qc.invalidateQueries({ queryKey: [key] })
      }
    },
  })
}

/** review_reason as a sentence ("amount above ₹5,000" → "Amount above ₹5,000"). */
export function reasonText(reason: string | null | undefined): string {
  if (!reason) return ''
  return reason.charAt(0).toUpperCase() + reason.slice(1)
}

export const confirmEntry = (id: string) => api<Entry>(`/entries/${id}/confirm`, { method: 'POST' })
export const voidEntry = (id: string) => api<Entry>(`/entries/${id}/void`, { method: 'POST' })

export { playB64 } from './player'

/** Explicit wording, never a bare minus sign (DESIGN.md §6.8). + = they owe the shop. */
export function balanceText(paise: number) {
  if (paise > 0) return t.parties.owesYou(formatPaise(paise))
  if (paise < 0) return t.parties.youOwe(formatPaise(-paise))
  return t.parties.settled
}
