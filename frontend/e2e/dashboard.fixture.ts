/**
 * GET /dashboard fixtures for the UI tests (GOAL_2.0 P6). Hand-written in the API's shape: the
 * numbers themselves are SQL's and are tested against the live database in
 * backend/tests/test_dashboard.py. Weekly subtotals here are summed from the fixture's own days,
 * the way register_weeks does it.
 */
import { today } from './mock'

const ZERO = { cash_sales_paise: 0, credit_given_paise: 0, collected_paise: 0, purchases_paise: 0, purchases_paid_paise: 0,
  supplier_paid_paise: 0, expenses_paise: 0, net_cash_paise: 0, entry_count: 0 }
type Fig = typeof ZERO

function monday(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}

function register(values: Record<number, Partial<Fig>>, openingCredit = 0, length = 30, endOffset = 0) {
  let outstanding = openingCredit
  const days = Array.from({ length }, (_, i) => endOffset + length - 1 - i).map((n) => {
    const f = { ...ZERO, ...(values[n] ?? {}) }
    f.net_cash_paise = f.cash_sales_paise + f.collected_paise - f.purchases_paid_paise - f.supplier_paid_paise - f.expenses_paise
    outstanding += f.credit_given_paise - f.collected_paise
    return { day: today(n), week_start: monday(today(n)), ...f, outstanding_credit_paise: outstanding }
  })
  const weeks: (Fig & { week_start: string; first_day: string; last_day: string })[] = []
  for (const d of days) {
    let w = weeks.find((x) => x.week_start === d.week_start)
    if (!w) { w = { ...ZERO, week_start: d.week_start, first_day: d.day, last_day: d.day }; weeks.push(w) }
    w.last_day = d.day
    for (const k of Object.keys(ZERO) as (keyof Fig)[]) w[k] += d[k]
  }
  return { from: today(endOffset + length - 1), to: today(endOffset), days, weeks }
}

const monthStart = () => `${today(0).slice(0, 8)}01`

export function emptyDashboard() {
  return {
    today: today(0),
    strip: ['cash_sales', 'credit_given', 'collected', 'expenses'].map((metric) => ({ metric, today_paise: 0, last_week_paise: 0, change_paise: 0 })),
    register: register({}),
    aging: { rows: [], buckets: ['0-7', '8-30', '31-60', '60+'].map((bucket) => ({ bucket, parties: 0, total_paise: 0 })) },
    dues: { rows: [] },
    expenses: { from: monthStart(), to: today(0), rows: [] },
    top_customers: { from: monthStart(), to: today(0), by_credit: [], by_collections: [] },
  }
}

export function seededDashboard(ids: { kavya: string; arjun: string; meena: string; lotus: string; balaji: string }) {
  return {
    today: today(0),
    strip: [
      { metric: 'cash_sales', today_paise: 30000, last_week_paise: 20000, change_paise: 10000 },
      { metric: 'credit_given', today_paise: 0, last_week_paise: 45000, change_paise: -45000 },
      { metric: 'collected', today_paise: 0, last_week_paise: 0, change_paise: 0 },
      { metric: 'expenses', today_paise: 11000, last_week_paise: 0, change_paise: 11000 },
    ],
    register: register({
      0: { cash_sales_paise: 30000, expenses_paise: 11000, entry_count: 3 },
      1: { purchases_paise: 30000, purchases_paid_paise: 30000, entry_count: 1 },
      2: { supplier_paid_paise: 10000, entry_count: 1 },
      3: { credit_given_paise: 20000, entry_count: 1 },
      5: { collected_paise: 15000, entry_count: 1 },
      6: { purchases_paise: 25000, entry_count: 1 },
      7: { cash_sales_paise: 20000, credit_given_paise: 45000, entry_count: 2 },
      12: { cash_sales_paise: 95000, entry_count: 4 },
      20: { credit_given_paise: 15000, entry_count: 1 },
    }, 80000),
    aging: {
      rows: [
        { party_id: ids.arjun, display_name: 'Arjun', balance_paise: 80000, first_credit_on: today(70), last_payment_on: null, age_from: today(70), age_days: 70, bucket: '60+' },
        { party_id: ids.kavya, display_name: 'Kavya', balance_paise: 40000, first_credit_on: today(40), last_payment_on: today(10), age_from: today(10), age_days: 10, bucket: '8-30' },
        { party_id: ids.meena, display_name: 'Meena', balance_paise: 20000, first_credit_on: today(3), last_payment_on: null, age_from: today(3), age_days: 3, bucket: '0-7' },
      ],
      buckets: [
        { bucket: '0-7', parties: 1, total_paise: 20000 }, { bucket: '8-30', parties: 1, total_paise: 40000 },
        { bucket: '31-60', parties: 0, total_paise: 0 }, { bucket: '60+', parties: 1, total_paise: 80000 },
      ],
    },
    dues: {
      rows: [
        { party_id: ids.lotus, display_name: 'Lotus Agencies', owed_paise: 60000, first_purchase_on: today(45), last_payment_on: today(35), age_from: today(35), days: 35, days_since_last_activity: 35 },
        { party_id: ids.balaji, display_name: 'Balaji Stores', owed_paise: 25000, first_purchase_on: today(6), last_payment_on: null, age_from: today(6), days: 6, days_since_last_activity: 6 },
      ],
    },
    expenses: { from: monthStart(), to: today(0), rows: [
      { category: 'rent', total_paise: 100000, entry_count: 1 }, { category: 'transport', total_paise: 7000, entry_count: 1 },
      { category: 'uncategorised', total_paise: 4000, entry_count: 1 }] },
    top_customers: { from: monthStart(), to: today(0),
      by_credit: [{ party_id: ids.kavya, display_name: 'Kavya', credit_given_paise: 70000, collected_paise: 10000 },
        { party_id: ids.meena, display_name: 'Meena', credit_given_paise: 20000, collected_paise: 5000 }],
      by_collections: [{ party_id: ids.kavya, display_name: 'Kavya', credit_given_paise: 70000, collected_paise: 10000 },
        { party_id: ids.meena, display_name: 'Meena', credit_given_paise: 20000, collected_paise: 5000 }] },
  }
}

/** GET /reports/data for [from, to] (both within the last 60 days): the seeded shop's figures. */
export function reportData(from: string, to: string, ids: { kavya: string; arjun: string; meena: string; lotus: string; balaji: string }) {
  const off = (iso: string) => Math.round((Date.parse(`${today(0)}T00:00:00Z`) - Date.parse(`${iso}T00:00:00Z`)) / 86_400_000)
  const end = off(to)
  const length = off(from) - end + 1
  const values: Record<number, Partial<Fig>> = {
    0: { cash_sales_paise: 30000, expenses_paise: 11000, entry_count: 3 }, 1: { purchases_paise: 30000, purchases_paid_paise: 30000, entry_count: 1 },
    2: { supplier_paid_paise: 10000, entry_count: 1 }, 3: { credit_given_paise: 20000, entry_count: 1 }, 5: { collected_paise: 15000, entry_count: 1 },
  }
  const reg = register(values, 0, length, end)
  const totals = { ...ZERO }
  for (const d of reg.days) for (const k of Object.keys(ZERO) as (keyof Fig)[]) totals[k] += d[k]
  const seeded = seededDashboard(ids)
  return { from, to, totals, register: { days: reg.days, weeks: reg.weeks }, aging: seeded.aging, dues: seeded.dues,
    expenses: [{ category: 'transport', total_paise: 7000, entry_count: 1 }, { category: 'uncategorised', total_paise: 4000, entry_count: 1 }] }
}
