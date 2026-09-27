import { useQuery } from '@tanstack/react-query'
import { api } from './api'

/** GET /dashboard (GOAL_2.0 P6). Every figure is a SQL result passed through; nothing here adds up. */
export type StripRow = { metric: 'cash_sales' | 'credit_given' | 'collected' | 'expenses'; today_paise: number; last_week_paise: number; change_paise: number }
export type RegisterFigures = {
  cash_sales_paise: number; credit_given_paise: number; collected_paise: number; purchases_paise: number
  purchases_paid_paise: number; supplier_paid_paise: number; expenses_paise: number; net_cash_paise: number; entry_count: number
}
export type RegisterDay = RegisterFigures & { day: string; week_start: string; outstanding_credit_paise: number }
export type RegisterWeek = RegisterFigures & { week_start: string; first_day: string; last_day: string }
export type AgingRow = {
  party_id: string; display_name: string; balance_paise: number; first_credit_on: string | null
  last_payment_on: string | null; age_from: string; age_days: number; bucket: Bucket
}
export type Bucket = '0-7' | '8-30' | '31-60' | '60+'
export type DueRow = {
  party_id: string; display_name: string; owed_paise: number; first_purchase_on: string | null
  last_payment_on: string | null; age_from: string; days: number; days_since_last_activity: number
}
export type PartyTotals = { party_id: string; display_name: string; credit_given_paise: number; collected_paise: number }
export type Dashboard = {
  today: string
  strip: StripRow[]
  register: { from: string; to: string; days: RegisterDay[]; weeks: RegisterWeek[] }
  aging: { rows: AgingRow[]; buckets: { bucket: Bucket; parties: number; total_paise: number }[] }
  dues: { rows: DueRow[] }
  expenses: { from: string; to: string; rows: { category: string; total_paise: number; entry_count: number }[] }
  top_customers: { from: string; to: string; by_credit: PartyTotals[]; by_collections: PartyTotals[] }
}

export const fetchDashboard = () => api<Dashboard>('/dashboard')
export const useDashboard = () => useQuery({ queryKey: ['dashboard'], queryFn: fetchDashboard, staleTime: 30_000 })
