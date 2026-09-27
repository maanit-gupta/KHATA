import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { Button } from '../components/ui/Button'
import { ChipButton, SegmentChip } from '../components/ui/Chip'
import { Field } from '../components/ui/Field'
import { StatusSquare } from '../components/ui/StatusSquare'
import { Toast } from '../components/ui/Toast'
import { balanceText, confirmEntry, reasonText, useLedgerMutation, useParties, type Entry, type Party } from '../lib/ledger'
import { formatPaise } from '../lib/money'
import { keepParty, mergeParty, renameParty, useReview, type ReviewRow } from '../lib/review'
import { PartyError } from '../components/PartyError'
import { SkeletonRows } from '../components/ui/Skeleton'
import { t } from '../strings'
import { Screen } from './AppShell'

/** DESIGN.md §6.10: pending entries, auto-created parties, failed bills — three hairline groups. */
export function ReviewScreen() {
  const review = useReview()
  const [notice, setNotice] = useState<string | null>(null)
  const rows = review.data?.rows ?? []
  const entries = rows.filter((r): r is Extract<ReviewRow, { item: 'entry' }> => r.item === 'entry')
  const parties = rows.filter((r): r is Extract<ReviewRow, { item: 'party' }> => r.item === 'party')
  const receipts = rows.filter((r): r is Extract<ReviewRow, { item: 'receipt' }> => r.item === 'receipt')

  return (
    <Screen title={t.screens.review}>
      {review.error && <p className="t-body-lg" role="alert">{review.error.message}</p>}
      {!review.data && !review.error && <SkeletonRows rows={4} />}
      {review.data && rows.length === 0 && <p className="t-body-lg">{t.review.empty}</p>}
      <div className="flex flex-col gap-12">
        {entries.length > 0 && (
          <Group title={t.review.pendingTitle}>
            {entries.map((r) => r.detail && <PendingEntry key={r.id} entry={r.detail} />)}
          </Group>
        )}
        {parties.length > 0 && (
          <Group title={t.review.partiesTitle}>
            {parties.map((r) => r.detail && <NewParty key={r.id} party={r.detail} onNotice={setNotice} />)}
          </Group>
        )}
        {receipts.length > 0 && (
          <Group title={t.review.receiptsTitle}>
            {receipts.map((r) => <FailedBill key={r.id} row={r} />)}
          </Group>
        )}
      </div>
      {notice && <Toast>{notice}</Toast>}
    </Screen>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-4 t-label-lg">{title}</h2>
      <ul className="border-b border-ink">{children}</ul>
    </section>
  )
}

function PendingEntry({ entry }: { entry: Entry }) {
  const navigate = useNavigate()
  const confirm = useLedgerMutation(confirmEntry)
  return (
    <li className="flex flex-col gap-4 border-t border-ink py-5" data-testid="review-entry">
      <div className="grid grid-cols-[24px_1fr_auto] items-start gap-3">
        <StatusSquare status="pending" className="mt-1" />
        <div>
          <p className="t-body-lg">{entry.party_name ?? entry.note ?? t.entryTypes[entry.type]}</p>
          <p className="t-label">{t.entryTypes[entry.type]} · {entry.occurred_on}</p>
          {entry.review_reason && <p className="mt-1 t-body">{reasonText(entry.review_reason)}</p>}
        </div>
        <p className="t-body-lg tabular-nums">{formatPaise(entry.amount_paise)}</p>
      </div>
      {confirm.error && <p className="t-body" role="alert">{confirm.error.message}</p>}
      <div className="grid grid-cols-2 gap-2">
        <Button disabled={confirm.isPending} onClick={() => confirm.mutate(entry.id)}>{t.ledger.confirm}</Button>
        <Button variant="outline" onClick={() => navigate(`/app/entries/${entry.id}`)}>{t.ledger.edit}</Button>
      </div>
    </li>
  )
}

function NewParty({ party, onNotice }: { party: Party; onNotice: (s: string) => void }) {
  const [mode, setMode] = useState<'idle' | 'rename' | 'merge'>('idle')
  const [name, setName] = useState(party.display_name)
  const all = useParties()
  const rename = useLedgerMutation(renameParty)
  const keep = useLedgerMutation(keepParty)
  const merge = useLedgerMutation(mergeParty)
  const error = rename.error ?? keep.error ?? merge.error
  const targets = (all.data ?? []).filter((p) => p.kind === party.kind && p.party_id !== party.party_id)

  function submit(e: FormEvent) {
    e.preventDefault()
    rename.mutate({ id: party.party_id, name: name.trim() }, { onSuccess: () => setMode('idle') })
  }

  return (
    <li className="flex flex-col gap-4 border-t border-ink py-5" data-testid="review-party">
      <div className="grid grid-cols-[24px_1fr_auto] items-start gap-3">
        <StatusSquare status="confirmed" className="mt-1" />
        <div>
          <p className="t-body-lg">{party.display_name} <span className="t-label">{t.status.new}</span></p>
          <p className="t-label">{party.kind === 'customer' ? t.parties.customer : t.parties.supplier}</p>
        </div>
        <p className="t-label">{balanceText(party.balance_paise)}</p>
      </div>
      {mode === 'idle' && (
        <div className="flex flex-wrap gap-2">
          <SegmentChip selected={false} onClick={() => setMode('rename')}>{t.review.rename}</SegmentChip>
          <SegmentChip selected={false} onClick={() => setMode('merge')}>{t.review.mergeInto}</SegmentChip>
          <SegmentChip selected={false} disabled={keep.isPending} onClick={() => keep.mutate(party.party_id)}>{t.review.keep}</SegmentChip>
        </div>
      )}
      {mode === 'rename' && (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field label={t.review.newName} required value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          <div className="grid grid-cols-2 gap-2">
            <Button type="submit" disabled={rename.isPending || !name.trim()}>{t.review.saveName}</Button>
            <Button variant="outline" onClick={() => setMode('idle')}>{t.review.cancel}</Button>
          </div>
        </form>
      )}
      {mode === 'merge' && (
        <div className="flex flex-col gap-3">
          <p className="t-body">{t.review.mergePick(party.display_name)}</p>
          {targets.length === 0 && <p className="t-body">{t.review.noMergeTarget}</p>}
          <div className="flex flex-wrap gap-2">
            {targets.map((p) => (
              <ChipButton key={p.party_id} disabled={merge.isPending}
                onClick={() => merge.mutate({ id: party.party_id, into: p.party_id },
                  { onSuccess: () => onNotice(t.review.merged(party.display_name, p.display_name)) })}>
                {p.display_name}
              </ChipButton>
            ))}
          </div>
          <Button variant="text" className="self-start" onClick={() => setMode('idle')}>{t.review.cancel}</Button>
        </div>
      )}
      <PartyError error={error} />
    </li>
  )
}

function FailedBill({ row }: { row: Extract<ReviewRow, { item: 'receipt' }> }) {
  const navigate = useNavigate()
  const r = row.detail
  return (
    <li className="flex flex-col gap-4 border-t border-ink py-5" data-testid="review-receipt">
      <div className="grid grid-cols-[24px_1fr_auto] items-start gap-3">
        <StatusSquare status="unselected" className="mt-1" />
        <div>
          <p className="t-body-lg">{r?.vendor_name ?? t.review.unreadBill(r ? t.scan[r.kind] : '')}</p>
          <p className="t-body">{reasonText(row.reason)}</p>
        </div>
        {r?.total_paise != null && <p className="t-body-lg tabular-nums">{formatPaise(r.total_paise)}</p>}
      </div>
      <Button onClick={() => navigate(`/app/scan?receipt=${row.id}`)}>{t.review.enterManually}</Button>
    </li>
  )
}
