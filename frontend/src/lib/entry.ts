import { useQuery } from '@tanstack/react-query'
import { api } from './api'
import type { Entry } from './ledger'

export type HistoryRow = {
  action: 'create' | 'edit' | 'confirm' | 'void'
  at: string
  by: 'you' | 'another_member'
  changes: { field: string; old: unknown; new: unknown }[]
}

/** What the pipeline heard (voice entries) or read (bill entries), GOAL_2.0 P1.3. */
export type Heard = { stt_raw: string | null; transcript_en: string | null; speech_text_en: string | null; speech_text_local: string | null; decision: string | null }
export type Read = { ocr_text: string | null; total_check: 'ok' | 'check' | null }

export const useEntry = (id: string) =>
  useQuery({ queryKey: ['entry', id], queryFn: () => api<{ entry: Entry; history: HistoryRow[]; heard?: Heard | null; read?: Read | null }>(`/entries/${id}`) })

export const patchEntry = ({ id, body }: { id: string; body: Record<string, unknown> }) =>
  api<Entry>(`/entries/${id}`, { method: 'PATCH', body: JSON.stringify(body) })

const when = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' })

/** Audit timestamps shown in shop time (CLAUDE.md §9b). */
export function formatWhen(iso: string) {
  return when.format(new Date(iso))
}
