import { useQuery } from '@tanstack/react-query'
import { api } from './api'

export type WeekFigures = {
  cash_sales_paise: number; credit_given_paise: number; collected_paise: number; expenses_paise: number
  purchases_paise: number; supplier_paid_paise: number; entry_count: number
}
export type Weekly = {
  week_start: string; week_end: string; today: string
  this_week: WeekFigures; last_week: WeekFigures
  top_debtors: { party_id: string; name: string; balance_paise: number; days_since_last_activity: number | null }[]
  narration: string; narration_en: string
}

/** GET /insights/weekly. The server caches for 15 minutes, so a 5-minute client cache is plenty. */
export const useWeekly = () =>
  useQuery({ queryKey: ['insights'], queryFn: () => api<Weekly>('/insights/weekly'), staleTime: 5 * 60_000 })
