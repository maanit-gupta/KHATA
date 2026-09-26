import type { ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { useReveal } from '../hooks/useReveal'
import type { Entry } from '../lib/ledger'
import { formatDay } from '../lib/dates'
import { formatPaise } from '../lib/money'
import { t } from '../strings/en'
import { Row } from './ui/Row'

/** Entry rows: status square | party (or type) with type · date | amount. Tapping opens Entry edit
 * (DESIGN.md §6.3). `aside` renders extra controls (evidence ▶ / →) outside the tap target. */
export function EntryList({ entries, empty, revealKey, aside }:
  { entries: Entry[] | undefined; empty: ReactNode; revealKey: string; aside?: (e: Entry) => ReactNode }) {
  const navigate = useNavigate()
  const reveal = useReveal({ key: revealKey })
  if (!entries) return null
  if (!entries.length) return <>{empty}</>
  return (
    <div className="border-b border-ink">
      {entries.map((e, i) => (
        <Row
          key={e.id}
          index={i}
          animate={reveal.animate}
          status={e.status}
          auto={e.auto_saved && e.status !== 'voided'}
          right={<span className="t-body-lg tabular-nums">{formatPaise(e.amount_paise)}</span>}
          onClick={() => navigate(`/app/entries/${e.id}`)}
          aside={aside?.(e)}
        >
          {e.party_name ?? e.note ?? t.entryTypes[e.type]}
          <span className="block t-label">{t.entryTypes[e.type]} · {formatDay(e.occurred_on)}</span>
        </Row>
      ))}
    </div>
  )
}
