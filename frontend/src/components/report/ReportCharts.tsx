import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'
import { formatShortDay } from '../../lib/dates'
import type { ReportData } from '../../lib/reports'
import { t } from '../../strings'

// Static SVG for print (GOAL_2.0 P7.3): fixed size, no animation, no tooltip. Ink and cyan only.
const INK = '#17181A'
const CYAN = '#B8F3FF'
const MIST = '#E8E9ED'
const W = 640
const H = 200
const TICK = { fill: INK, fontSize: 11 }
const axis = { stroke: INK, strokeWidth: 1 }
const rupeesTick = (paise: number) =>
  `₹${new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }).format(paise / 100)}`

export function ReportCharts({ data }: { data: ReportData }) {
  const D = t.dashboard
  const days = data.register.days
  const step = Math.max(1, Math.ceil(days.length / 6))
  const ticks = days.filter((_, i) => i % step === 0).map((d) => d.day)
  const expenses = data.expenses.map((r) => ({ ...r, name: t.categories.names[r.category] ?? r.category }))
  return (
    <div className="report-charts grid gap-6">
      {days.length > 1 && (
        <figure className="flex flex-col gap-2" data-testid="report-chart-sales">
          <figcaption className="t-label">{D.salesVsCollections} · {D.sales} ■ · {D.collections} □</figcaption>
          <LineChart width={W} height={H} data={days} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={MIST} />
            <XAxis dataKey="day" ticks={ticks} tickFormatter={(v: string) => formatShortDay(v)} tick={TICK} axisLine={axis} tickLine={false} />
            <YAxis tickFormatter={rupeesTick} tick={TICK} axisLine={axis} tickLine={false} width={52} />
            <Line type="linear" dataKey="cash_sales_paise" stroke={INK} strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line type="linear" dataKey="collected_paise" stroke={INK} strokeWidth={2} strokeDasharray="6 4" dot={false} isAnimationActive={false} />
          </LineChart>
        </figure>
      )}
      {expenses.length > 0 && (
        <figure className="flex flex-col gap-2" data-testid="report-chart-expenses">
          <figcaption className="t-label">{t.reports.expensesTitle}</figcaption>
          <BarChart width={W} height={Math.max(80, 36 * expenses.length)} data={expenses} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }}>
            <XAxis type="number" tickFormatter={rupeesTick} tick={TICK} axisLine={axis} tickLine={false} />
            <YAxis type="category" dataKey="name" tick={TICK} axisLine={axis} tickLine={false} width={160} />
            <Bar dataKey="total_paise" fill={CYAN} stroke={INK} strokeWidth={1} radius={0} isAnimationActive={false} />
          </BarChart>
        </figure>
      )}
    </div>
  )
}
