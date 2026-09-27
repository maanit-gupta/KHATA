import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { api } from '../lib/api'
import { relativeTime } from '../lib/dates'
import type { EntryType } from '../lib/ledger'
import { shown } from '../lib/members'
import { formatPaise } from '../lib/money'
import { SkeletonRows } from './ui/Skeleton'
import { t } from '../strings'
import { StatusSquare, type Status } from './ui/StatusSquare'

type Activity = { id: number; at: string; action: 'create' | 'edit' | 'confirm' | 'void'; entry_id: string; by: string
  by_you: boolean; type: EntryType | null; amount_paise: number | null; party_name: string | null; note: string | null; changed: string[] }

const SQUARE: Record<Activity['action'], Status> = { create: 'confirmed', edit: 'unselected', confirm: 'confirmed', void: 'voided' }

const useActivity = () => useQuery({ queryKey: ['activity'], queryFn: () => api<{ activity: Activity[] }>('/activity').then((r) => r.activity) })

/** GOAL_2.0 P4.4: the last 30 actions, "who · what · when", newest first. */
export function ActivityFeed() {
  const q = useActivity()
  return (
    <section aria-labelledby="activity-title" className="flex flex-col gap-4">
      <h2 id="activity-title" className="t-h3">{t.activity.title}</h2>
      {q.error && <p className="t-body-lg" role="alert">{q.error.message}</p>}
      {!q.data && !q.error && <SkeletonRows rows={5} />}
      {q.data && q.data.length === 0 && <p className="border-t border-ink pt-4 t-body-lg">{t.activity.empty}</p>}
      {q.data && q.data.length > 0 && (
        <ol className="border-b border-ink" data-testid="activity-feed">
          {q.data.map((a) => {
            const what = [a.type && t.entryTypes[a.type], a.amount_paise != null && formatPaise(a.amount_paise), a.party_name ?? a.note]
              .filter(Boolean).join(' · ')
            const fields = a.changed.map((f) => (t.entry.fields[f === 'party_id' ? 'party' : f] ?? f).toLowerCase()).join(', ')
            return (
              <li key={a.id} className="flex items-start gap-3 border-t border-ink py-3">
                <StatusSquare status={SQUARE[a.action]} className="mt-[5px]" />
                <Link to={`/app/entries/${a.entry_id}`} className="flex min-h-12 flex-1 flex-col justify-center underline-offset-4 hover:underline">
                  <span className="t-body-lg">{t.activity.line(shown(a.by), t.activity.verbs[a.action], what)}{fields && ` ${t.activity.changed(fields)}`}</span>
                  <span className="t-label">{relativeTime(a.at)}</span>
                </Link>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
