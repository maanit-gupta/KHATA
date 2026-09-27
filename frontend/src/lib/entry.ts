import { useQuery } from '@tanstack/react-query'
import { api } from './api'
import type { Entry } from './ledger'
import { formatDay } from './dates'
import { uiLang } from '../strings'

export type HistoryRow = {
  action: 'create' | 'edit' | 'confirm' | 'void'
  at: string
  /** The member's name, "(you)" after your own (GOAL_2.0 P4.1). */
  by: string
  by_you?: boolean
  changes: { field: string; old: unknown; new: unknown }[]
}

/** What the pipeline heard (voice entries) or read (bill entries), GOAL_2.0 P1.3. */
export type Heard = { stt_raw: string | null; transcript_en: string | null; speech_text_en: string | null; speech_text_local: string | null; decision: string | null }
export type Read = { ocr_text: string | null; total_check: 'ok' | 'check' | null }

export const useEntry = (id: string) =>
  useQuery({ queryKey: ['entry', id], queryFn: () => api<{ entry: Entry; history: HistoryRow[]; heard?: Heard | null; read?: Read | null }>(`/entries/${id}`) })

export const patchEntry = ({ id, body }: { id: string; body: Record<string, unknown> }) =>
  api<Entry>(`/entries/${id}`, { method: 'PATCH', body: JSON.stringify(body) })

/** Audit timestamps in shop time (CLAUDE.md §9b): "26 Sep 2026, 9:35 am" (GOAL_2.0 P8), month names
 * in the on-screen language, 0–9 digits. */
export function formatWhen(iso: string) {
  const d = new Date(iso)
  const day = new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10)
  const time = new Intl.DateTimeFormat(uiLang(), { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata', numberingSystem: 'latn' }).format(d)
  return `${formatDay(day)}, ${time}`
}
