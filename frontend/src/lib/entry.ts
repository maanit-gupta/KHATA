import { useQuery } from '@tanstack/react-query'
import { api } from './api'
import type { Entry } from './ledger'

export type HistoryRow = {
  action: 'create' | 'edit' | 'confirm' | 'void'
  at: string
  by: 'you' | 'another_member'
  changes: { field: string; old: unknown; new: unknown }[]
}

export const useEntry = (id: string) =>
  useQuery({ queryKey: ['entry', id], queryFn: () => api<{ entry: Entry; history: HistoryRow[] }>(`/entries/${id}`) })

export const patchEntry = ({ id, body }: { id: string; body: Record<string, unknown> }) =>
  api<Entry>(`/entries/${id}`, { method: 'PATCH', body: JSON.stringify(body) })

const when = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' })

/** Audit timestamps shown in shop time (CLAUDE.md §9b). */
export function formatWhen(iso: string) {
  return when.format(new Date(iso))
}
