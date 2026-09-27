import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api'
import type { Bucket, RegisterDay, RegisterWeek, RegisterFigures } from './dashboard'
import { todayIst } from './dates'

/** GOAL_2.0 P7. Summaries are phrased by the LLM from SQL facts and number-guarded server-side. */
export type Period = 'day' | 'week' | 'month'
export type Summary = {
  period: Period; period_start: string; from: string; to: string; lang: string
  summary: string; tips: string[]; summary_en: string; tips_en: string[]
  tip_facts: ({ rule: string } & Record<string, unknown>)[]; cached: boolean; generated_at: string
}

export const useSummary = (period: Period) =>
  useQuery({ queryKey: ['report', 'summary', period], queryFn: () => api<Summary>(`/reports/summary?period=${period}`), staleTime: 60_000 })

export function useRefreshSummary(period: Period) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api<Summary>('/reports/summary/refresh', { method: 'POST', body: JSON.stringify({ period }) }),
    onSuccess: (s) => qc.setQueryData(['report', 'summary', period], s),
  })
}

export type ReportData = {
  from: string; to: string; totals: RegisterFigures
  register: { days: RegisterDay[]; weeks: RegisterWeek[] }
  aging: { rows: { party_id: string; display_name: string; balance_paise: number; age_from: string; age_days: number; last_payment_on: string | null; bucket: Bucket }[]
    buckets: { bucket: Bucket; parties: number; total_paise: number }[] }
  dues: { rows: { party_id: string; display_name: string; owed_paise: number; last_payment_on: string | null; days: number }[] }
  expenses: { category: string; total_paise: number; entry_count: number }[]
}

export const useReportData = (from: string, to: string) =>
  useQuery({ queryKey: ['report', 'data', from, to], queryFn: () => api<ReportData>(`/reports/data?from=${from}&to=${to}`) })

export type Briefing = { day: string; lang: string; text: string; text_en: string; voice: string; audio_cached: boolean }

export const useBriefing = (enabled: boolean) =>
  useQuery({ queryKey: ['briefing', todayIst()], queryFn: () => api<Briefing>('/briefing'), enabled, staleTime: 10 * 60_000 })

export const briefingAudio = () => api<{ url: string; cached: boolean }>('/briefing/audio', { method: 'POST' })
