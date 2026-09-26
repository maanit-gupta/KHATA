import { useQuery } from '@tanstack/react-query'
import { api } from './api'
import type { EntryType } from './ledger'
import { formatPaise } from './money'

export type StatementRow = { entry_id: string; occurred_on: string; type: EntryType; amount_paise: number; note: string | null
  source: string; delta_paise: number; running_balance_paise: number }
export type Statement = { from: string | null; to: string | null; opening_balance_paise: number
  closing_balance_paise: number; rows: StatementRow[] }

export const useStatement = (partyId: string, from: string, to: string) =>
  useQuery({
    queryKey: ['party', partyId, 'statement', from, to],
    queryFn: () => api<Statement>(`/parties/${partyId}/statement?${new URLSearchParams({ ...(from && { from }), ...(to && { to }) })}`),
  })

export function signed(paise: number): string {
  if (paise === 0) return '—'
  return `${paise > 0 ? '+' : '−'}${formatPaise(Math.abs(paise))}`
}

