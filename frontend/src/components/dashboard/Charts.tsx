import type { ReactNode } from 'react'
import { Area, Bar, BarChart, CartesianGrid, ComposedChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatShortDay } from '../../lib/dates'
import type { Dashboard, RegisterDay } from '../../lib/dashboard'
import { formatPaise } from '../../lib/money'
import { t } from '../../strings'

// DESIGN.md §2 tokens (tokens.css), as literals because chart SVG attributes don't read CSS vars
// everywhere. Ink and cyan only; flat fills, no gradients, square corners and markers.
const INK = '#17181A'
const CYAN = '#B8F3FF'
const MIST = '#E8E9ED'
const TICK = { fill: INK, fontSize: 12 }

const rupeesTick = (paise: number) =>
  `₹${new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }).format(paise / 100)}`

/** A square data marker (DESIGN.md: squares only as markers). */
function Square({ cx, cy, fill, size = 7, value }: { cx?: number; cy?: number; fill: string; size?: number; value?: number }) {
  if (cx == null || cy == null || value === 0) return null   // quiet days carry no marker
  return <rect x={cx - size / 2} y={cy - size / 2} width={size} height={size} fill={fill} stroke={INK} strokeWidth={1} />
}

type TipProps = { active?: boolean; label?: string; payload?: { name?: string; value?: number }[] }
function Tip({ active, label, payload }: TipProps) {
  if (!active || !payload?.length) return null
  return (
    <div className="border border-ink bg-paper px-3 py-2 t-body">
      {label && <p className="t-label">{label.length === 10 ? formatShortDay(label) : label}</p>}
      {payload.map((p) => <p key={p.name}>{p.name}: {formatPaise(p.value ?? 0)}</p>)}
    </div>
  )
}

function Legend({ items }: { items: [string, ReactNode][] }) {
  return (
    <ul className="flex flex-wrap gap-4 t-label">
      {items.map(([name, mark]) => <li key={name} className="flex items-center gap-2">{mark}{name}</li>)}
    </ul>
  )
}

function Panel({ title, summary, testId, children, legend, help }:
  { title: string; summary: string; testId: string; children: ReactNode; legend?: ReactNode; help?: string }) {
  return (
    <figure className="flex min-w-0 flex-col gap-3 border-t border-ink pt-4" data-testid={testId}>
      <figcaption className="flex flex-col gap-2">
        <span className="t-label-lg">{title}</span>
        {legend}
        {help && <span className="t-body">{help}</span>}
      </figcaption>
      <div className="h-[220px] w-full" role="img" aria-label={summary}>{children}</div>
    </figure>
  )
}

const axis = { stroke: INK, strokeWidth: 1 }

export function DashboardCharts({ data }: { data: Dashboard }) {
  const days: RegisterDay[] = data.register.days
  const D = t.dashboard
  const range = [formatShortDay(data.register.from), formatShortDay(data.register.to)] as const
  const ticks = days.filter((_, i) => i % 7 === (days.length - 1) % 7).map((d) => d.day)
  const x = <XAxis dataKey="day" ticks={ticks} tickFormatter={(v: string) => formatShortDay(v)} tick={TICK} axisLine={axis} tickLine={false} />
  const y = <YAxis tickFormatter={rupeesTick} tick={TICK} axisLine={axis} tickLine={false} width={56} />
  const grid = <CartesianGrid vertical={false} stroke={MIST} />
  const expenses = data.expenses.rows.map((r) => ({ ...r, name: t.categories.names[r.category] ?? r.category }))
  return (
    <section aria-labelledby="charts-title" className="flex flex-col gap-6">
      <h2 id="charts-title" className="t-h3">{D.chartsTitle}</h2>
      <div className="grid gap-8 app:grid-cols-3">
        <Panel title={D.salesVsCollections} testId="chart-sales" summary={D.chartSummary(D.salesVsCollections, ...range)}
          legend={<Legend items={[[D.sales, <span key="s" className="inline-block size-3 bg-ink" />],
            [D.collections, <span key="c" className="inline-block size-3 border border-ink bg-cyan" />]]} />}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={days} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              {grid}{x}{y}
              <Tooltip content={<Tip />} cursor={{ stroke: INK, strokeWidth: 1 }} />
              <Line type="linear" dataKey="cash_sales_paise" name={D.sales} stroke={INK} strokeWidth={2} isAnimationActive={false}
                dot={(p) => <Square key={`s${p.index}`} cx={p.cx} cy={p.cy} fill={INK} size={6} value={p.value as number} />} activeDot={(p) => <Square cx={p.cx} cy={p.cy} fill={INK} size={9} />} />
              <Line type="linear" dataKey="collected_paise" name={D.collections} stroke={INK} strokeWidth={2} strokeDasharray="6 4" isAnimationActive={false}
                dot={(p) => <Square key={`c${p.index}`} cx={p.cx} cy={p.cy} fill={CYAN} size={7} value={p.value as number} />} activeDot={(p) => <Square cx={p.cx} cy={p.cy} fill={CYAN} size={10} />} />
            </LineChart>
          </ResponsiveContainer>
        </Panel>
        <Panel title={D.outstanding} testId="chart-outstanding" help={D.outstandingHelp} summary={D.chartSummary(D.outstanding, ...range)}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={days} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              {grid}{x}{y}
              <Tooltip content={<Tip />} cursor={{ stroke: INK, strokeWidth: 1 }} />
              <Area type="stepAfter" dataKey="outstanding_credit_paise" name={D.outstanding} stroke={INK} strokeWidth={2}
                fill={CYAN} fillOpacity={1} isAnimationActive={false} activeDot={(p) => <Square cx={p.cx} cy={p.cy} fill={INK} size={9} />} />
            </ComposedChart>
          </ResponsiveContainer>
        </Panel>
        <Panel title={D.expensesTitle} testId="chart-expenses" summary={D.chartSummary(D.expensesTitle, formatShortDay(data.expenses.from), formatShortDay(data.expenses.to))}>
          {expenses.length === 0 ? <p className="t-body-lg">{D.expensesEmpty}</p> : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={expenses} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid horizontal={false} stroke={MIST} />
                <XAxis type="number" tickFormatter={rupeesTick} tick={TICK} axisLine={axis} tickLine={false} />
                <YAxis type="category" dataKey="name" tick={TICK} axisLine={axis} tickLine={false} width={104} />
                <Tooltip content={<Tip />} cursor={{ fill: MIST }} />
                <Bar dataKey="total_paise" name={D.expensesTitle} fill={CYAN} stroke={INK} strokeWidth={1} radius={0} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Panel>
      </div>
    </section>
  )
}
