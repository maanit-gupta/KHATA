import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api, apiBlob } from './api'
import { addDays, todayIst } from './dates'
import type { EntryType } from './ledger'

export type LedgerRow = {
  id: string; occurred_on: string; created_at: string; type: EntryType; amount_paise: number
  status: 'pending' | 'confirmed' | 'voided'; source: 'voice' | 'receipt' | 'manual'
  party_id: string | null; party_name: string | null; party_kind: 'customer' | 'supplier' | null
  note: string | null; created_by: string | null; confirmed_by: string | null; added_by: string | null
  confirmed_by_name: string | null; auto_saved: boolean; review_reason: string | null
  receipt_id: string | null; voice_note_id: string | null; expense_category: string | null
}
export type LedgerPage = {
  rows: LedgerRow[]; page: number; page_size: number; total_count: number; pages: number
  totals: { cash_in_paise: number; credit_given_paise: number; collected_paise: number; expenses_paise: number }
  members: { user_id: string; name: string }[]
}

export type Preset = 'all' | 'today' | 'week' | 'month' | 'custom'
export const PRESETS: Preset[] = ['all', 'today', 'week', 'month', 'custom']

/** A preset → from/to in IST. The week starts on Monday, like the weekly summary. */
export function presetRange(p: Preset, today = todayIst()): { from?: string; to?: string } {
  if (p === 'today') return { from: today, to: today }
  if (p === 'week') {
    const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7 // Monday = 0
    return { from: addDays(today, -dow), to: today }
  }
  if (p === 'month') return { from: `${today.slice(0, 8)}01`, to: today }
  return {}
}

/** The API query string for the current filters (URL search params are the source of truth). */
export function ledgerQuery(params: URLSearchParams, extra: Record<string, string> = {}): string {
  const q = new URLSearchParams()
  const preset = (params.get('period') as Preset) || 'all'
  const range = preset === 'custom' ? { from: params.get('from') ?? undefined, to: params.get('to') ?? undefined } : presetRange(preset)
  if (range.from) q.set('from', range.from)
  if (range.to) q.set('to', range.to)
  for (const k of ['type', 'party', 'source', 'member', 'status', 'q']) {
    const v = params.get(k)
    if (v) q.set(k, v)
  }
  for (const [k, v] of Object.entries(extra)) q.set(k, v)
  return q.toString()
}

export function useLedgerPage(params: URLSearchParams) {
  const page = params.get('page') ?? '1'
  const qs = ledgerQuery(params, { page })
  return useQuery({
    queryKey: ['ledger', qs],
    queryFn: () => api<LedgerPage>(`/ledger?${qs}`),
    placeholderData: keepPreviousData, // changing a filter keeps the old rows until the new ones land
  })
}

/** GET /ledger/export.csv with the same filters, saved as a file (the API needs the auth header,
 * so a plain link won't do). */
export async function downloadCsv(params: URLSearchParams) {
  const { blob, filename } = await apiBlob(`/ledger/export.csv?${ledgerQuery(params)}`)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename ?? 'khata-ledger.csv'
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
