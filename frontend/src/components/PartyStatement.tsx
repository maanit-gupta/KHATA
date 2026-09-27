import { useState } from 'react'
import { formatDay } from '../lib/dates'
import { balanceText } from '../lib/ledger'
import { signed, useStatement, type Statement } from '../lib/statement'
import { t } from '../strings'
import { ButtonLink } from './ui/Button'
import { Field } from './ui/Field'
import { ScrollBox } from './ui/ScrollBox'

const S = t.parties.statement

/** GOAL_2.0 P3.2: date | description | +/− | balance after, from SQL (party_statement). */
export function StatementTable({ name, st }: { name: string; st: Statement }) {
  return (
    <ScrollBox label={S.caption(name)}>
      <table className="w-full min-w-[560px] border-collapse text-left" data-testid="statement-table">
        <caption className="sr-only">{S.caption(name)}</caption>
        <thead>
          <tr className="border-b border-ink">
            {[S.cols.date, S.cols.description, S.cols.change, S.cols.balance].map((c, i) => (
              <th key={c} scope="col" className={`py-3 pr-4 t-label font-normal ${i >= 2 ? 'text-right' : ''}`}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {st.from && (
            <tr className="border-b border-ink">
              <th scope="row" className="py-3 pr-4 t-body font-normal whitespace-nowrap">{formatDay(st.from)}</th>
              <td className="py-3 pr-4 t-body">{S.opening}</td>
              <td className="py-3 pr-4 text-right t-body">—</td>
              <td className="py-3 text-right t-body whitespace-nowrap">{balanceText(st.opening_balance_paise)}</td>
            </tr>
          )}
          {st.rows.map((r) => (
            <tr key={r.entry_id} className="border-b border-ink">
              <th scope="row" className="py-3 pr-4 t-body font-normal whitespace-nowrap">{formatDay(r.occurred_on)}</th>
              <td className="py-3 pr-4 t-body">{t.entryTypes[r.type]}{r.note ? ` · ${r.note}` : ''}</td>
              <td className="py-3 pr-4 text-right t-body tabular-nums whitespace-nowrap">{signed(r.delta_paise)}</td>
              <td className="py-3 text-right t-body tabular-nums whitespace-nowrap">{balanceText(r.running_balance_paise)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" colSpan={3} className="py-3 pr-4 t-label font-normal">{S.closing}</th>
            <td className="py-3 text-right t-body-lg tabular-nums whitespace-nowrap" data-testid="statement-closing">{balanceText(st.closing_balance_paise)}</td>
          </tr>
        </tfoot>
      </table>
    </ScrollBox>
  )
}

export function PartyStatement({ partyId, name }: { partyId: string; name: string }) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const q = useStatement(partyId, from, to)
  const share = `/app/report?${new URLSearchParams({ party: partyId, ...(from && { from }), ...(to && { to }) })}`
  return (
    <section className="flex flex-col gap-4" aria-labelledby="statement-title">
      <h2 id="statement-title" className="t-h3">{S.title}</h2>
      <div className="grid grid-cols-2 gap-4">
        <Field label={S.from} type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
        <Field label={S.to} type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
      </div>
      <p className="t-body">{S.help}</p>
      {q.error && <p className="t-body-lg" role="alert">{q.error.message}</p>}
      {q.data && (q.data.rows.length || q.data.from
        ? <StatementTable name={name} st={q.data} />
        : <p className="border-t border-ink pt-4 t-body-lg">{S.empty}</p>)}
      <ButtonLink to={share} variant="outline">{S.share}</ButtonLink>
    </section>
  )
}
