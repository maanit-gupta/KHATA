import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { ManualAdd } from '../components/ManualAdd'
import { Button } from '../components/ui/Button'
import { SegmentChip } from '../components/ui/Chip'
import { Field } from '../components/ui/Field'
import { H2 } from '../components/ui/H2'
import { ScrollBox } from '../components/ui/ScrollBox'
import { Select } from '../components/ui/Select'
import { StatusSquare } from '../components/ui/StatusSquare'
import { formatDay } from '../lib/dates'
import { ENTRY_TYPES, useParties } from '../lib/ledger'
import { shown } from '../lib/members'
import { downloadCsv, PRESETS, useLedgerPage, type LedgerRow, type Preset } from '../lib/ledgerTable'
import { formatPaise } from '../lib/money'
import { SkeletonRows } from '../components/ui/Skeleton'
import { t } from '../strings'

const L = t.table
const STATUSES = ['confirmed', 'pending', 'voided'] as const

/**
 * GOAL_2.0 P3.1: the whole book as a table. Filters live in the URL (so back and reload keep them);
 * pagination, totals and the CSV are server-side. The table scrolls sideways inside its own box on a
 * phone; the page never does (DESIGN.md).
 */
export function LedgerTableScreen() {
  const [params, setParams] = useSearchParams()
  const q = useLedgerPage(params)
  const parties = useParties()
  const [adding, setAdding] = useState(false)
  const [search, setSearch] = useState(params.get('q') ?? '')
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const preset = (params.get('period') as Preset) || 'all'
  const statuses = (params.get('status') ?? '').split(',').filter(Boolean)

  function set(changes: Record<string, string | null>) {
    // Built on the live URL, not on this render's copy: two quick changes (a preset, then a type)
    // must add up even before React re-renders. (React Router's functional form still uses the
    // params of the last render.)
    const next = new URLSearchParams(window.location.search)
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v)
      else next.delete(k)
    }
    if (!('page' in changes)) next.delete('page') // any filter change starts again on page 1
    setParams(next, { replace: true })
  }

  useEffect(() => {
    const id = window.setTimeout(() => {
      if ((params.get('q') ?? '') !== search.trim()) set({ q: search.trim() || null })
    }, 300)
    return () => window.clearTimeout(id)
  }) // re-armed every render; fires once typing pauses

  function toggleStatus(s: string) {
    // Default (nothing chosen) = confirmed + pending. Voided shows only when chosen.
    const current = statuses.length ? statuses : ['confirmed', 'pending']
    const next = current.includes(s) ? current.filter((x) => x !== s) : [...current, s]
    const isDefault = next.length === 2 && next.includes('confirmed') && next.includes('pending')
    set({ status: isDefault || next.length === 0 ? null : next.join(',') })
  }
  const isShown = (s: string) => (statuses.length ? statuses.includes(s) : s !== 'voided')

  const data = q.data
  const anyFilter = [...params.keys()].some((k) => k !== 'page')
  return (
    <div className="grid gap-8 gutter-x py-10 app:grid-cols-3 app:py-16">
      <div className="flex min-w-0 flex-col gap-6">
        <H2 lines={L.heading} as="h1" />
        <fieldset>
          <legend className="mb-2 t-field-label">{L.period}</legend>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <SegmentChip key={p} selected={preset === p} onClick={() => set({ period: p === 'all' ? null : p, ...(p !== 'custom' ? { from: null, to: null } : {}) })}>
                {L.presets[p]}
              </SegmentChip>
            ))}
          </div>
        </fieldset>
        {preset === 'custom' && (
          <div className="grid grid-cols-2 gap-4">
            <Field label={L.from} type="date" value={params.get('from') ?? ''} onChange={(e) => set({ from: e.target.value || null })} />
            <Field label={L.to} type="date" value={params.get('to') ?? ''} onChange={(e) => set({ to: e.target.value || null })} />
          </div>
        )}
        <Field label={L.search} type="search" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select label={L.type} value={params.get('type') ?? ''} onChange={(e) => set({ type: e.target.value || null })}
          options={[{ value: '', label: L.allTypes }, ...ENTRY_TYPES.map((k) => ({ value: k, label: t.entryTypes[k] }))]} />
        <Select label={L.party} value={params.get('party') ?? ''} onChange={(e) => set({ party: e.target.value || null })}
          options={[{ value: '', label: L.allParties }, ...(parties.data ?? []).map((p) => ({ value: p.party_id, label: p.display_name }))]} />
        <Select label={L.source} value={params.get('source') ?? ''} onChange={(e) => set({ source: e.target.value || null })}
          options={[{ value: '', label: L.allSources }, ...['voice', 'receipt', 'manual'].map((k) => ({ value: k, label: L.sources[k] }))]} />
        <Select label={L.member} value={params.get('member') ?? ''} onChange={(e) => set({ member: e.target.value || null })}
          options={[{ value: '', label: L.allMembers }, ...(data?.members ?? []).map((m) => ({ value: m.user_id, label: shown(m.name) }))]} />
        <fieldset>
          <legend className="mb-2 t-field-label">{L.show}</legend>
          <div className="flex flex-wrap gap-2">
            {STATUSES.map((s) => (
              <SegmentChip key={s} selected={isShown(s)} onClick={() => toggleStatus(s)}>{t.status[s]}</SegmentChip>
            ))}
          </div>
        </fieldset>
        {anyFilter && <Button variant="text" className="self-start" onClick={() => { setSearch(''); setParams(new URLSearchParams(), { replace: true }) }}>{L.clear}</Button>}
      </div>

      <div className="flex min-w-0 flex-col gap-8 app:col-span-2">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Button variant="text" onClick={() => setAdding((a) => !a)} aria-expanded={adding}>{adding ? t.ledger.closeForm : t.ledger.addByHand}</Button>
          <Button variant="text" disabled={exporting} onClick={() => {
            setExporting(true); setExportError(null)
            downloadCsv(params).catch((e: Error) => setExportError(e.message)).finally(() => setExporting(false))
          }}>{exporting ? L.exporting : L.export}</Button>
        </div>
        {exportError && <p className="t-body" role="alert">{exportError}</p>}
        {adding && <ManualAdd />}
        {q.error && <p className="t-body-lg" role="alert">{q.error.message}</p>}
        {!data && !q.error && <SkeletonRows rows={8} />}
        {data && <Totals totals={data.totals} />}
        {data && <Table rows={data.rows} />}
        {data && data.rows.length === 0 && <p className="border-t border-ink pt-6 t-body-lg">{L.empty}</p>}
        {data && data.total_count > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-4" data-testid="pager">
            <p className="t-label">{L.count(data.total_count)} · {L.page(data.page, data.pages)}</p>
            <div className="flex gap-2">
              <Button variant="outline" arrow={false} className="w-auto" disabled={data.page <= 1} onClick={() => set({ page: String(data.page - 1) })}>{L.prev}</Button>
              <Button variant="outline" className="w-auto" disabled={data.page >= data.pages} onClick={() => set({ page: String(data.page + 1) })}>{L.next}</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Totals({ totals }: { totals: { cash_in_paise: number; credit_given_paise: number; collected_paise: number; expenses_paise: number } }) {
  const items = [[L.totals.cashIn, totals.cash_in_paise], [L.totals.credit, totals.credit_given_paise],
    [L.totals.collected, totals.collected_paise], [L.totals.expenses, totals.expenses_paise]] as const
  return (
    <section aria-label={L.totals.note} data-testid="ledger-totals">
      <dl className="grid grid-cols-2 gap-px border border-ink bg-ink app:grid-cols-4">
        {items.map(([label, v]) => (
          <div key={label} className="flex flex-col gap-2 bg-paper p-4">
            <dt className="t-label">{label}</dt>
            <dd className="t-amount tabular-nums">{formatPaise(v)}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 t-body">{L.totals.note}</p>
    </section>
  )
}

function Table({ rows }: { rows: LedgerRow[] }) {
  const navigate = useNavigate()
  if (rows.length === 0) return null
  return (
    <ScrollBox label={L.caption} testId="ledger-table-scroll">
      <table className="w-full min-w-[760px] border-collapse text-left">
        <caption className="sr-only">{L.caption}</caption>
        <thead>
          <tr className="border-b border-ink">
            {[L.cols.date, L.cols.party, L.cols.type, L.cols.amount, L.cols.source, L.cols.addedBy, L.cols.status].map((c, i) => (
              <th key={c} scope="col" className={`py-3 pr-4 t-label font-normal ${i === 3 ? 'text-right' : ''}`}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const voided = r.status === 'voided'
            const who = r.party_name ?? r.note ?? t.ledger.noParty
            const open = () => navigate(`/app/entries/${r.id}`)
            return (
              <tr key={r.id} onClick={open} data-status={r.status}
                className={`cursor-pointer border-b border-ink hover:bg-bone ${voided ? 'line-through' : ''}`}>
                <th scope="row" className="py-3 pr-4 t-body font-normal whitespace-nowrap">
                  <a href={`/app/entries/${r.id}`} onClick={(e) => { e.preventDefault(); open() }} aria-label={L.open(`${who} ${formatPaise(r.amount_paise)}`)}
                    className="inline-flex min-h-12 items-center underline-offset-4 hover:underline">
                    {formatDay(r.occurred_on)}
                  </a>
                </th>
                <td className="py-3 pr-4 t-body">{who}</td>
                <td className="py-3 pr-4 t-body">{t.entryTypes[r.type]}</td>
                <td className="py-3 pr-4 text-right t-body tabular-nums whitespace-nowrap">{formatPaise(r.amount_paise)}</td>
                <td className="py-3 pr-4 t-body">{L.sources[r.source]}</td>
                <td className="py-3 pr-4 t-body">{shown(r.added_by)}</td>
                <td className="py-3 t-body whitespace-nowrap">
                  <span className="inline-flex items-center gap-2"><StatusSquare status={r.status} size={12} />{t.status[r.status]}</span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </ScrollBox>
  )
}
