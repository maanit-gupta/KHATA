import { useState } from 'react'
import { Link } from 'react-router'
import { formatDay, formatShortDay } from '../../lib/dates'
import type { AgingRow, Dashboard, DueRow, PartyTotals, RegisterDay, RegisterFigures } from '../../lib/dashboard'
import { formatPaise } from '../../lib/money'
import { t } from '../../strings'
import { ScrollBox } from '../ui/ScrollBox'
import { StatusSquare } from '../ui/StatusSquare'

const TH = 'py-3 pr-4 t-label font-normal'
const TD = 'py-3 pr-4 t-body tabular-nums whitespace-nowrap'

/** "+₹100 vs 20 Sep" / "−₹100 vs 20 Sep" / "Same as 20 Sep" (P6.1). The change itself is SQL's. */
function change(paise: number, day: string) {
  if (paise === 0) return t.dashboard.same(day)
  return t.dashboard.vs(`${paise > 0 ? '+' : '−'}${formatPaise(Math.abs(paise))}`, day)
}

export function TodayStrip({ data }: { data: Dashboard }) {
  const lastWeek = formatShortDay(new Date(Date.parse(`${data.today}T00:00:00Z`) - 7 * 86_400_000).toISOString())
  const label = { cash_sales: t.week.cash, credit_given: t.week.credit, collected: t.week.collected, expenses: t.week.expenses }
  return (
    <section aria-labelledby="today-title" className="flex flex-col gap-3" data-testid="today-strip">
      <h2 id="today-title" className="t-label-lg">{t.dashboard.today} · {formatDay(data.today)}</h2>
      <dl className="grid grid-cols-2 gap-px border border-ink bg-ink app:grid-cols-4">
        {data.strip.map((s) => (
          <div key={s.metric} className="flex min-w-0 flex-col gap-2 bg-paper p-4" data-metric={s.metric}>
            <dt className="t-label">{label[s.metric]}</dt>
            <dd className="t-amount tabular-nums">{formatPaise(s.today_paise)}</dd>
            <dd className="t-body">{change(s.change_paise, lastWeek)}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

type Col = keyof Pick<RegisterFigures, 'cash_sales_paise' | 'credit_given_paise' | 'collected_paise' | 'purchases_paise' | 'supplier_paid_paise' | 'expenses_paise' | 'net_cash_paise'>
const REGISTER_COLS: [Col, keyof typeof t.dashboard.register.cols][] = [
  ['cash_sales_paise', 'cash'], ['credit_given_paise', 'credit'], ['collected_paise', 'collected'], ['purchases_paise', 'purchases'],
  ['supplier_paid_paise', 'supplierPaid'], ['expenses_paise', 'expenses'], ['net_cash_paise', 'net'],
]
type Sort = { col: 'day' | Col; dir: 'asc' | 'desc' }

/**
 * P6.2 daily register: sortable; in date order, each Mon–Sun week ends with its subtotal row (from
 * SQL's register_weeks). Sorted by an amount, the subtotals step aside: they only make sense by date.
 */
export function RegisterTable({ data }: { data: Dashboard }) {
  const R = t.dashboard.register
  const [sort, setSort] = useState<Sort>({ col: 'day', dir: 'desc' })
  const days = [...data.register.days].sort((a, b) => {
    const d = sort.col === 'day' ? a.day.localeCompare(b.day) : a[sort.col] - b[sort.col]
    return (sort.dir === 'asc' ? d : -d) || b.day.localeCompare(a.day)
  })
  const byDate = sort.col === 'day'
  const weeks = new Map(data.register.weeks.map((w) => [w.week_start, w]))
  const rows: ({ kind: 'day'; d: RegisterDay } | { kind: 'week'; w: (typeof data.register.weeks)[number] })[] = []
  days.forEach((d, i) => {
    rows.push({ kind: 'day', d })
    const next = days[i + 1]
    // In date order a week's rows are contiguous: close it where the week changes (or at the end).
    if (byDate && (!next || next.week_start !== d.week_start)) {
      const w = weeks.get(d.week_start)
      if (w) rows.push({ kind: 'week', w })
    }
  })
  function header(col: Sort['col'], name: string, right = true) {
    const active = sort.col === col
    const next: Sort = active ? { col, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'desc' }
    return (
      <th key={col} scope="col" aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'} className={`${TH} ${right ? 'text-right' : ''}`}>
        <button type="button" onClick={() => setSort(next)} aria-label={R.sort(name)}
          className={`inline-flex min-h-12 items-center gap-1 underline-offset-4 hover:underline ${active ? 'underline' : ''}`}>
          {name}{active && <span aria-hidden className={`inline-block ${sort.dir === 'asc' ? '-rotate-90' : 'rotate-90'}`}>{t.arrow}</span>}
        </button>
      </th>
    )
  }
  return (
    <section aria-labelledby="register-title" className="flex min-w-0 flex-col gap-3">
      <h2 id="register-title" className="t-h3">{R.title}</h2>
      <p className="t-body">{R.help}</p>
      <ScrollBox label={R.caption} testId="register-scroll">
        <table className="w-full min-w-[860px] border-collapse text-left" data-testid="register">
          <caption className="sr-only">{R.caption}</caption>
          <thead>
            <tr className="border-b border-ink">
              {header('day', R.cols.day, false)}
              {REGISTER_COLS.map(([k, label]) => header(k, R.cols[label]))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => r.kind === 'day' ? (
              <tr key={r.d.day} className="border-b border-mist" data-day={r.d.day}>
                <th scope="row" className={`${TD} font-normal`}>{formatDay(r.d.day)}</th>
                {REGISTER_COLS.map(([k]) => <td key={k} className={`${TD} text-right`}>{money(r.d[k])}</td>)}
              </tr>
            ) : (
              <tr key={`w${r.w.week_start}`} className="border-b border-ink bg-mist" data-week={r.w.week_start}>
                <th scope="row" className={`${TD} font-normal t-label`}>{R.week(formatShortDay(r.w.first_day), formatShortDay(r.w.last_day))}</th>
                {REGISTER_COLS.map(([k]) => <td key={k} className={`${TD} text-right`}>{money(r.w[k])}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollBox>
      <p className="t-body" id="net-help" data-testid="net-help">{R.netHelp}</p>
    </section>
  )
}

/** Negative amounts (net cash) read "−₹300". */
const money = (paise: number) => (paise < 0 ? `−${formatPaise(-paise)}` : formatPaise(paise))

const BUCKET_SQUARE = { '0-7': 'confirmed', '8-30': 'pending', '31-60': 'pending', '60+': 'voided' } as const

export function AgingTable({ data }: { data: Dashboard }) {
  const A = t.dashboard.aging
  return (
    <section aria-labelledby="aging-title" className="flex min-w-0 flex-col gap-3" data-testid="aging">
      <h2 id="aging-title" className="t-h3">{A.title}</h2>
      <p className="t-body">{A.help}</p>
      <dl className="grid grid-cols-2 gap-px border border-ink bg-ink app:grid-cols-4" data-testid="aging-buckets">
        {data.aging.buckets.map((b) => (
          <div key={b.bucket} className="flex flex-col gap-1 bg-paper p-3" data-bucket={b.bucket}>
            <dt className="flex items-center gap-2 t-label"><StatusSquare status={BUCKET_SQUARE[b.bucket]} size={10} />{A.bucket(b.bucket)}</dt>
            <dd className="t-body-lg tabular-nums">{formatPaise(b.total_paise)}</dd>
            <dd className="t-body">{A.total(b.parties)}</dd>
          </div>
        ))}
      </dl>
      {data.aging.rows.length === 0 ? <p className="border-t border-ink pt-4 t-body-lg">{A.empty}</p> : (
        <ScrollBox label={A.caption}>
          <table className="w-full min-w-[640px] border-collapse text-left">
            <caption className="sr-only">{A.caption}</caption>
            <thead>
              <tr className="border-b border-ink">
                <th scope="col" className={TH}>{A.cols.name}</th>
                <th scope="col" className={`${TH} text-right`}>{A.cols.balance}</th>
                <th scope="col" className={TH}>{A.cols.oldest}</th>
                <th scope="col" className={TH}>{A.cols.lastPayment}</th>
                <th scope="col" className={TH}>{A.cols.bucket}</th>
              </tr>
            </thead>
            <tbody>
              {data.aging.rows.map((r: AgingRow) => (
                <tr key={r.party_id} className="border-b border-mist" data-party={r.display_name}>
                  <th scope="row" className="py-3 pr-4 t-body font-normal">
                    <Link to={`/app/parties/${r.party_id}`} className="inline-flex min-h-12 items-center underline underline-offset-4">{r.display_name}</Link>
                  </th>
                  <td className={`${TD} text-right`}>{formatPaise(r.balance_paise)}</td>
                  <td className={TD}>{formatDay(r.age_from)} · {A.days(r.age_days)}</td>
                  <td className={TD}>{r.last_payment_on ? formatDay(r.last_payment_on) : A.never}</td>
                  <td className={TD}><span className="inline-flex items-center gap-2"><StatusSquare status={BUCKET_SQUARE[r.bucket]} size={10} />{A.bucket(r.bucket)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollBox>
      )}
    </section>
  )
}

export function DuesTable({ data }: { data: Dashboard }) {
  const U = t.dashboard.dues
  return (
    <section aria-labelledby="dues-title" className="flex min-w-0 flex-col gap-3" data-testid="dues">
      <h2 id="dues-title" className="t-h3">{U.title}</h2>
      <p className="t-body">{U.help}</p>
      {data.dues.rows.length === 0 ? <p className="border-t border-ink pt-4 t-body-lg">{U.empty}</p> : (
        <ScrollBox label={U.caption}>
          <table className="w-full min-w-[520px] border-collapse text-left">
            <caption className="sr-only">{U.caption}</caption>
            <thead>
              <tr className="border-b border-ink">
                <th scope="col" className={TH}>{U.cols.name}</th>
                <th scope="col" className={`${TH} text-right`}>{U.cols.owed}</th>
                <th scope="col" className={TH}>{U.cols.lastPayment}</th>
                <th scope="col" className={`${TH} text-right`}>{U.cols.days}</th>
              </tr>
            </thead>
            <tbody>
              {data.dues.rows.map((r: DueRow) => (
                <tr key={r.party_id} className="border-b border-mist" data-party={r.display_name}>
                  <th scope="row" className="py-3 pr-4 t-body font-normal">
                    <Link to={`/app/parties/${r.party_id}`} className="inline-flex min-h-12 items-center underline underline-offset-4">{r.display_name}</Link>
                  </th>
                  <td className={`${TD} text-right`}>{formatPaise(r.owed_paise)}</td>
                  <td className={TD}>{r.last_payment_on ? formatDay(r.last_payment_on) : t.dashboard.aging.never}</td>
                  <td className={`${TD} text-right`}>{r.days}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollBox>
      )}
    </section>
  )
}

function TopList({ title, rows, field, testId }: { title: string; rows: PartyTotals[]; field: 'credit_given_paise' | 'collected_paise'; testId: string }) {
  const T = t.dashboard.top
  return (
    <div className="flex min-w-0 flex-col gap-2" data-testid={testId}>
      <h3 className="t-label-lg">{title}</h3>
      {rows.length === 0 ? <p className="border-t border-ink pt-3 t-body">{T.empty}</p> : (
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">{title}</caption>
          <thead className="sr-only"><tr><th scope="col">{T.name}</th><th scope="col">{T.amount}</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.party_id} className="border-t border-ink">
                <th scope="row" className="py-2 pr-4 t-body font-normal">
                  <Link to={`/app/parties/${r.party_id}`} className="inline-flex min-h-12 items-center underline-offset-4 hover:underline">{r.display_name}</Link>
                </th>
                <td className="py-2 text-right t-body-lg tabular-nums">{formatPaise(r[field])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

export function TopCustomers({ data }: { data: Dashboard }) {
  const T = t.dashboard.top
  return (
    <section aria-labelledby="top-title" className="flex flex-col gap-4">
      <h2 id="top-title" className="t-h3">{T.title}</h2>
      <div className="grid gap-8 app:grid-cols-2">
        <TopList title={T.byCredit} rows={data.top_customers.by_credit} field="credit_given_paise" testId="top-credit" />
        <TopList title={T.byCollections} rows={data.top_customers.by_collections} field="collected_paise" testId="top-collections" />
      </div>
    </section>
  )
}
