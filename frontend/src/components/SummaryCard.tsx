import { useState } from 'react'
import { Link } from 'react-router'
import { useRefreshSummary, useSummary, type Period } from '../lib/reports'
import { t } from '../strings'
import { Button } from './ui/Button'
import { SegmentChip } from './ui/Chip'
import { StatusSquare } from './ui/StatusSquare'

const PERIODS: Period[] = ['day', 'week']

/**
 * GOAL_2.0 P7.2: the day's or week's figures and the top tips, phrased by the LLM from SQL facts in
 * the report language. Every number was checked against the facts on the server (a failure falls
 * back to a plain template), so this card never shows a number SQL didn't produce.
 */
export function SummaryCard() {
  const [period, setPeriod] = useState<Period>('day')
  const q = useSummary(period)
  const refresh = useRefreshSummary(period)
  const s = q.data
  const time = s ? new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }).format(new Date(s.generated_at)) : ''
  return (
    <section aria-labelledby="summary-title" className="flex flex-col gap-5 bg-cyan p-6 app:p-8" data-testid="summary-card">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 id="summary-title" className="t-h3">{t.reports.summaryTitle}</h2>
        <div className="flex gap-2" role="group" aria-label={t.reports.period}>
          {PERIODS.map((p) => <SegmentChip key={p} selected={period === p} onClick={() => setPeriod(p)}>{t.reports.tabs[p]}</SegmentChip>)}
        </div>
      </div>
      {q.error && <p className="t-body" role="alert">{q.error.message}</p>}
      {!s && !q.error && <p className="t-body" role="status">{t.errors.loading}</p>}
      {s && (
        <>
          <p className="t-body-lg" lang={s.lang} aria-live="polite" data-testid="summary-text">{s.summary}</p>
          <div className="flex flex-col gap-2">
            <h3 className="t-label">{t.reports.tipsTitle}</h3>
            {s.tips.length === 0 ? <p className="t-body">{t.reports.noTips}</p> : (
              <ul className="border-b border-ink" data-testid="tips">
                {s.tips.map((tip, i) => (
                  <li key={i} className="flex items-start gap-3 border-t border-ink py-3" data-rule={s.tip_facts[i]?.rule}>
                    <StatusSquare status="pending" className="mt-[5px]" size={10} />
                    <span className="t-body-lg" lang={s.lang}>{tip}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p className="t-body">{t.reports.written(time)}</p>
          {refresh.error && <p className="t-body" role="alert">{refresh.error.message}</p>}
          <div className="flex flex-wrap items-center gap-6">
            <Button variant="text" onClick={() => refresh.mutate()} disabled={refresh.isPending}>{refresh.isPending ? t.reports.refreshing : t.reports.refresh}</Button>
            <Link to={`/app/report?period=${period}`} className="inline-flex min-h-12 items-center t-label-lg underline underline-offset-4">{t.reports.open} {t.arrow}</Link>
          </div>
        </>
      )}
    </section>
  )
}
