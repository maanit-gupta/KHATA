import type { ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useMe } from '../auth/hooks'
import { StatementTable } from '../components/PartyStatement'
import { ReportCharts } from '../components/report/ReportCharts'
import { Button } from '../components/ui/Button'
import { SegmentChip } from '../components/ui/Chip'
import { Field } from '../components/ui/Field'
import { H2 } from '../components/ui/H2'
import { StatusSquare } from '../components/ui/StatusSquare'
import { addDays, formatDay, formatShortDay, todayIst } from '../lib/dates'
import { formatWhen } from '../lib/entry'
import { formatPaise } from '../lib/money'
import { useReportData, useSummary, type Period, type ReportData } from '../lib/reports'
import { useStatement } from '../lib/statement'
import { t } from '../strings'

const PERIODS: Period[] = ['day', 'week', 'month']

function periodRange(period: Period, today = todayIst()): { from: string; to: string } {
  if (period === 'day') return { from: today, to: today }
  if (period === 'month') return { from: `${today.slice(0, 8)}01`, to: today }
  const d = new Date(`${today}T00:00:00Z`)
  return { from: addDays(today, -((d.getUTCDay() + 6) % 7)), to: today }
}

const money = (paise: number) => (paise < 0 ? `−${formatPaise(-paise)}` : formatPaise(paise))
const generatedAt = () => formatWhen(new Date().toISOString())

/**
 * GOAL_2.0 P7.3: a print-optimised report at /app/report?period=day|week|month&from=&to= (and
 * ?party=&from=&to= for a statement). DOWNLOAD PDF opens the browser's print window: the browser
 * shapes all six Indic scripts correctly (D-065). The print stylesheet (index.css) fits A4.
 */
export function ReportScreen() {
  const [params, setParams] = useSearchParams()
  const party = params.get('party')
  const me = useMe()
  const shopName = me.data?.shop?.name ?? ''
  if (party) return <StatementReport partyId={party} from={params.get('from') ?? ''} to={params.get('to') ?? ''} shop={shopName} />
  const period = (PERIODS.includes(params.get('period') as Period) ? params.get('period') : 'week') as Period
  const def = periodRange(period)
  const from = params.get('from') ?? def.from
  const to = params.get('to') ?? def.to
  const current = from === def.from && to === def.to
  const set = (next: Record<string, string | null>) => {
    const p = new URLSearchParams(window.location.search)
    for (const [k, v] of Object.entries(next)) { if (v) p.set(k, v); else p.delete(k) }
    setParams(p, { replace: true })
  }
  return (
    <div className="report-page flex flex-col gap-8 gutter-x py-10 app:py-16">
      <Controls>
        <div className="flex flex-wrap gap-2" role="group" aria-label={t.reports.period}>
          {PERIODS.map((p) => (
            <SegmentChip key={p} selected={period === p} onClick={() => set({ period: p, from: null, to: null })}>{t.reports.tabs[p]}</SegmentChip>
          ))}
        </div>
        <div className="grid max-w-md grid-cols-2 gap-4">
          <Field label={t.table.from} type="date" value={from} max={to} onChange={(e) => set({ from: e.target.value || null })} />
          <Field label={t.table.to} type="date" value={to} min={from} max={todayIst()} onChange={(e) => set({ to: e.target.value || null })} />
        </div>
      </Controls>
      <PeriodReport period={period} from={from} to={to} current={current} shop={shopName} />
    </div>
  )
}

function Controls({ children }: { children: ReactNode }) {
  return (
    <div className="no-print flex flex-col gap-4 border-b border-ink pb-6" data-testid="report-controls">
      {children}
      <div className="flex flex-wrap items-center gap-6">
        <Button className="w-auto" onClick={() => window.print()}>{t.reports.download}</Button>
        <Link to="/app/dashboard" className="inline-flex min-h-12 items-center t-label-lg underline underline-offset-4">{t.reports.back}</Link>
      </div>
      <p className="t-body">{t.reports.printHelp}</p>
    </div>
  )
}

function Footer({ shop, from, to }: { shop: string; from: string; to: string }) {
  return (
    <footer className="report-footer border-t border-ink pt-3 t-label" data-testid="report-footer">
      {t.reports.footer(shop, `${formatDay(from)} – ${formatDay(to)}`, generatedAt())}
    </footer>
  )
}

function PeriodReport({ period, from, to, current, shop }: { period: Period; from: string; to: string; current: boolean; shop: string }) {
  const data = useReportData(from, to)
  const summary = useSummary(period)
  const d = data.data
  return (
    <article className="report flex flex-col gap-8" data-testid="report">
      <header className="flex flex-col gap-2">
        <p className="t-label-lg">{t.brand} · {shop}</p>
        <H2 lines={t.reports.heading} as="h1" />
        <p className="t-body-lg" data-testid="report-range">{formatDay(from)} – {formatDay(to)}</p>
      </header>
      {data.error && <p className="t-body-lg" role="alert">{data.error.message}</p>}
      {current && summary.data && (
        <section className="flex flex-col gap-3 border border-ink p-5" data-testid="report-summary">
          <h2 className="t-label-lg">{t.reports.summaryTitle}</h2>
          <p className="t-body-lg" lang={summary.data.lang}>{summary.data.summary}</p>
          {summary.data.tips.length > 0 && (
            <ul className="flex flex-col gap-2">
              {summary.data.tips.map((tip, i) => (
                <li key={i} className="flex items-start gap-3"><StatusSquare status="pending" size={10} className="mt-[5px]" /><span className="t-body" lang={summary.data.lang}>{tip}</span></li>
              ))}
            </ul>
          )}
        </section>
      )}
      {d && (
        <>
          <Totals d={d} />
          <ReportCharts data={d} />
          <Register d={d} />
          <Aging d={d} />
          <Dues d={d} />
        </>
      )}
      {!d && !data.error && <p className="t-body-lg" role="status">{t.errors.loading}</p>}
      <Footer shop={shop} from={from} to={to} />
    </article>
  )
}

function Totals({ d }: { d: ReportData }) {
  const R = t.dashboard.register.cols
  const items: [string, number][] = [[R.cash, d.totals.cash_sales_paise], [R.credit, d.totals.credit_given_paise],
    [R.collected, d.totals.collected_paise], [R.purchases, d.totals.purchases_paise], [R.supplierPaid, d.totals.supplier_paid_paise],
    [R.expenses, d.totals.expenses_paise], [R.net, d.totals.net_cash_paise]]
  return (
    <section className="flex flex-col gap-3 avoid-break">
      <h2 className="t-h3">{t.reports.totalsTitle}</h2>
      <dl className="grid grid-cols-2 gap-px border border-ink bg-ink sm:grid-cols-4" data-testid="report-totals">
        {items.map(([label, v]) => (
          <div key={label} className="flex flex-col gap-1 bg-paper p-3"><dt className="t-label">{label}</dt><dd className="t-body-lg tabular-nums">{money(v)}</dd></div>
        ))}
        <div aria-hidden className="bg-paper" />{/* 7 figures: keep the grid's last cell white */}
      </dl>
      <p className="t-body">{t.dashboard.register.netHelp}</p>
    </section>
  )
}

const TH = 'py-2 pr-3 t-label font-normal'
const TD = 'py-2 pr-3 t-body tabular-nums whitespace-nowrap'

function Register({ d }: { d: ReportData }) {
  const R = t.dashboard.register
  const cols = [['cash_sales_paise', R.cols.cash], ['credit_given_paise', R.cols.credit], ['collected_paise', R.cols.collected],
    ['purchases_paise', R.cols.purchases], ['supplier_paid_paise', R.cols.supplierPaid], ['expenses_paise', R.cols.expenses],
    ['net_cash_paise', R.cols.net]] as const
  const rows: ReactNode[] = []
  d.register.days.forEach((day, i) => {
    rows.push(
      <tr key={day.day} className="border-b border-mist">
        <th scope="row" className={`${TD} font-normal`}>{formatDay(day.day)}</th>
        {cols.map(([k]) => <td key={k} className={`${TD} text-right`}>{money(day[k])}</td>)}
      </tr>)
    const next = d.register.days[i + 1]
    if (!next || next.week_start !== day.week_start) {
      const w = d.register.weeks.find((x) => x.week_start === day.week_start)
      if (w && d.register.days.length > 7) rows.push(
        <tr key={`w${w.week_start}`} className="border-b border-ink bg-mist">
          <th scope="row" className={`${TD} font-normal t-label`}>{R.week(formatShortDay(w.first_day), formatShortDay(w.last_day))}</th>
          {cols.map(([k]) => <td key={k} className={`${TD} text-right`}>{money(w[k])}</td>)}
        </tr>)
    }
  })
  return (
    <section className="flex flex-col gap-3">
      <h2 className="t-h3">{R.title}</h2>
      <table className="w-full border-collapse text-left" data-testid="report-register">
        <thead><tr className="border-b border-ink"><th scope="col" className={TH}>{R.cols.day}</th>{cols.map(([k, l]) => <th key={k} scope="col" className={`${TH} text-right`}>{l}</th>)}</tr></thead>
        <tbody>{rows}</tbody>
      </table>
    </section>
  )
}

function Aging({ d }: { d: ReportData }) {
  const A = t.dashboard.aging
  return (
    <section className="flex flex-col gap-3 avoid-break">
      <h2 className="t-h3">{A.title}</h2>
      <p className="t-body">{A.help}</p>
      <dl className="grid grid-cols-4 gap-px border border-ink bg-ink">
        {d.aging.buckets.map((b) => (
          <div key={b.bucket} className="flex flex-col gap-1 bg-paper p-2"><dt className="t-label">{A.bucket(b.bucket)}</dt><dd className="t-body tabular-nums">{formatPaise(b.total_paise)} · {A.total(b.parties)}</dd></div>
        ))}
      </dl>
      {d.aging.rows.length === 0 ? <p className="t-body">{A.empty}</p> : (
        <table className="w-full border-collapse text-left" data-testid="report-aging">
          <thead><tr className="border-b border-ink">{[A.cols.name, A.cols.balance, A.cols.oldest, A.cols.lastPayment, A.cols.bucket].map((c, i) => <th key={c} scope="col" className={`${TH} ${i === 1 ? 'text-right' : ''}`}>{c}</th>)}</tr></thead>
          <tbody>
            {d.aging.rows.map((r) => (
              <tr key={r.party_id} className="border-b border-mist">
                <th scope="row" className="py-2 pr-3 t-body font-normal">{r.display_name}</th>
                <td className={`${TD} text-right`}>{formatPaise(r.balance_paise)}</td>
                <td className={TD}>{formatDay(r.age_from)} · {A.days(r.age_days)}</td>
                <td className={TD}>{r.last_payment_on ? formatDay(r.last_payment_on) : A.never}</td>
                <td className={TD}>{A.bucket(r.bucket)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

function Dues({ d }: { d: ReportData }) {
  const U = t.dashboard.dues
  return (
    <section className="flex flex-col gap-3 avoid-break">
      <h2 className="t-h3">{U.title}</h2>
      {d.dues.rows.length === 0 ? <p className="t-body">{U.empty}</p> : (
        <table className="w-full border-collapse text-left" data-testid="report-dues">
          <thead><tr className="border-b border-ink">{[U.cols.name, U.cols.owed, U.cols.lastPayment, U.cols.days].map((c, i) => <th key={c} scope="col" className={`${TH} ${i === 1 || i === 3 ? 'text-right' : ''}`}>{c}</th>)}</tr></thead>
          <tbody>
            {d.dues.rows.map((r) => (
              <tr key={r.party_id} className="border-b border-mist">
                <th scope="row" className="py-2 pr-3 t-body font-normal">{r.display_name}</th>
                <td className={`${TD} text-right`}>{formatPaise(r.owed_paise)}</td>
                <td className={TD}>{r.last_payment_on ? formatDay(r.last_payment_on) : t.dashboard.aging.never}</td>
                <td className={`${TD} text-right`}>{r.days}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

function StatementReport({ partyId, from, to, shop }: { partyId: string; from: string; to: string; shop: string }) {
  const q = useStatement(partyId, from, to)
  const st = q.data
  const name = st?.party?.display_name ?? ''
  return (
    <div className="report-page flex flex-col gap-8 gutter-x py-10 app:py-16">
      <Controls>{null}</Controls>
      <article className="report flex flex-col gap-6" data-testid="report">
        <header className="flex flex-col gap-2">
          <p className="t-label-lg">{t.brand} · {shop}</p>
          <h1 className="t-h2">{t.reports.statementTitle(name)}</h1>
          {(from || to) && <p className="t-body-lg">{from ? formatDay(from) : ''} – {to ? formatDay(to) : formatDay(todayIst())}</p>}
        </header>
        {q.error && <p className="t-body-lg" role="alert">{q.error.message}</p>}
        {st && <StatementTable name={name} st={st} />}
        <p className="t-body">{t.parties.statement.help}</p>
        <Footer shop={shop} from={st?.from || st?.rows[0]?.occurred_on || from || todayIst()} to={to || todayIst()} />
      </article>
    </div>
  )
}
