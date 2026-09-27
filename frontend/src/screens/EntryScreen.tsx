import { useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router'
import { Button } from '../components/ui/Button'
import { Disclosure } from '../components/ui/Disclosure'
import { SegmentChip } from '../components/ui/Chip'
import { Field } from '../components/ui/Field'
import { H2 } from '../components/ui/H2'
import { StatusSquare } from '../components/ui/StatusSquare'
import { Toast } from '../components/ui/Toast'
import { formatWhen, patchEntry, useEntry, type HistoryRow } from '../lib/entry'
import { confirmEntry, ENTRY_TYPES, reasonText, useLedgerMutation, voidEntry, type Entry, type EntryType } from '../lib/ledger'
import { shown } from '../lib/members'
import { openBill, playRecording } from '../lib/media'
import { formatPaise } from '../lib/money'
import { t } from '../strings'

const PARTY_OPTIONAL: EntryType[] = ['cash_sale', 'purchase_paid']

/** DESIGN.md §6.11: dark form with every field, SAVE CHANGES →, the audit history, VOID with a
 * confirmation. */
export function EntryScreen() {
  const { id = '' } = useParams()
  const q = useEntry(id)
  return (
    <div className="grid gap-8 gutter-x py-10 app:grid-cols-3 app:py-16">
      <div className="flex flex-col gap-4">
        <H2 lines={t.entry.heading} as="h1" />
        {q.data && <Summary entry={q.data.entry} />}
        {q.data?.heard && (
          <Disclosure label={t.ledger.whatIHeard} testId="what-i-heard">
            <p className="t-body whitespace-pre-wrap">{q.data.heard.stt_raw?.trim() ? `“${q.data.heard.stt_raw.trim()}”` : t.ledger.heardNothing}</p>
          </Disclosure>
        )}
        {q.data?.read && (
          <Disclosure label={t.scan.whatIRead} testId="what-i-read">
            <p className="max-h-[50vh] overflow-y-auto t-body whitespace-pre-wrap break-words">{q.data.read.ocr_text?.trim() || t.scan.readNothing}</p>
          </Disclosure>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-10 app:col-span-2">
        {q.error && <p className="t-body-lg" role="alert">{q.error.message}</p>}
        {q.data && <EditForm key={q.data.entry.id + q.data.entry.status} entry={q.data.entry} />}
        {q.data && <History rows={q.data.history} />}
      </div>
    </div>
  )
}

function Summary({ entry }: { entry: Entry }) {
  const [err, setErr] = useState<string | null>(null)
  const fail = (e: unknown) => setErr((e as Error).message)
  return (
    <div className="flex flex-col gap-3">
      <p className="flex items-center gap-3 t-label"><StatusSquare status={entry.status} />{t.status[entry.status]} · {t.entry.source[entry.source]}</p>
      <p className={`t-amount ${entry.status === 'voided' ? 'line-through' : ''}`}>{formatPaise(entry.amount_paise)}</p>
      {entry.added_by && <p className="t-body" data-testid="added-by">{t.entry.addedBy(shown(entry.added_by))}</p>}
      {entry.confirmed_by_name && entry.confirmed_by && entry.confirmed_by !== entry.created_by && entry.status === 'confirmed' && (
        <p className="t-body" data-testid="confirmed-by">{t.entry.confirmedBy(shown(entry.confirmed_by_name))}</p>
      )}
      {entry.review_reason && entry.status === 'pending' && <p className="t-body">{reasonText(entry.review_reason)}</p>}
      <div className="flex gap-2">
        {entry.voice_note_id && (
          <button type="button" aria-label={t.parties.playRecording} onClick={() => playRecording(entry.voice_note_id!).catch(fail)}
            className="inline-flex size-12 items-center justify-center bg-ink text-paper"><span aria-hidden className="text-[14px] leading-none">▶</span></button>
        )}
        {entry.receipt_id && (
          <button type="button" aria-label={t.parties.openBill} onClick={() => openBill(entry.receipt_id!).catch(fail)}
            className="inline-flex size-12 items-center justify-center border border-ink t-label-lg"><span aria-hidden>{t.arrow}</span></button>
        )}
      </div>
      {err && <p className="t-body" role="alert">{err}</p>}
    </div>
  )
}

function EditForm({ entry }: { entry: Entry }) {
  const navigate = useNavigate()
  const [type, setType] = useState<EntryType>(entry.type)
  const [amount, setAmount] = useState(String(entry.amount_paise / 100))
  const [party, setParty] = useState(entry.party_name ?? '')
  const [date, setDate] = useState(entry.occurred_on)
  const [note, setNote] = useState(entry.note ?? '')
  const [askVoid, setAskVoid] = useState(false)
  const [saved, setSaved] = useState(false)
  const save = useLedgerMutation(patchEntry)
  const voidIt = useLedgerMutation(voidEntry)
  const confirm = useLedgerMutation(confirmEntry)
  const voided = entry.status === 'voided'
  const needsParty = type !== 'expense'
  const partyRequired = needsParty && !PARTY_OPTIONAL.includes(type)

  function submit(ev: FormEvent) {
    ev.preventDefault()
    const body: Record<string, unknown> = {}
    if (type !== entry.type) body.type = type
    if (Math.round(Number(amount) * 100) !== entry.amount_paise) body.amount_rupees = Number(amount)
    if (date !== entry.occurred_on) body.occurred_on = date
    if ((note || null) !== entry.note) body.note = note
    if (needsParty && party.trim() && party.trim() !== (entry.party_name ?? '')) body.party_name = party.trim()
    save.mutate({ id: entry.id, body }, { onSuccess: () => { setSaved(true); window.setTimeout(() => setSaved(false), 2000) } })
  }

  if (voided) return <p className="t-body-lg" data-testid="voided-note">{t.entry.voided}</p>

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={submit} className="on-dark flex flex-col gap-8 bg-ink p-6 text-paper app:p-10" aria-label={t.entry.heading.join(' ')}>
        <fieldset>
          <legend className="mb-2 t-field-label">{t.ledger.type}</legend>
          <div className="flex flex-wrap gap-2">
            {ENTRY_TYPES.map((k) => (
              <SegmentChip key={k} dark selected={type === k} onClick={() => setType(k)}>{t.entryTypes[k]}</SegmentChip>
            ))}
          </div>
        </fieldset>
        <Field dark label={t.ledger.amount} required inputMode="decimal" type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
        {needsParty && <Field dark label={t.entry.party} required={partyRequired} value={party} onChange={(e) => setParty(e.target.value)} />}
        <Field dark label={t.entry.date} type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
        <Field dark label={t.ledger.note} value={note} onChange={(e) => setNote(e.target.value)} />
        {save.error && <p className="t-body" role="alert">{save.error.message}</p>}
        <Button type="submit" variant="inverse" disabled={save.isPending}>{save.isPending ? t.ledger.working : t.entry.saveChanges}</Button>
      </form>
      {entry.status === 'pending' && (
        <Button disabled={confirm.isPending} onClick={() => confirm.mutate(entry.id)}>{t.ledger.confirm}</Button>
      )}
      {!askVoid ? (
        <Button variant="text" className="self-start" onClick={() => setAskVoid(true)}>{t.entry.voidEntry}</Button>
      ) : (
        <div role="alertdialog" aria-labelledby="void-title" className="flex flex-col gap-4 border-t border-ink pt-6">
          <p id="void-title" className="t-h3">{t.entry.voidConfirmTitle}</p>
          <p className="t-body-lg">{t.entry.voidConfirmBody}</p>
          {voidIt.error && <p className="t-body" role="alert">{voidIt.error.message}</p>}
          <div className="grid grid-cols-2 gap-2">
            <Button disabled={voidIt.isPending} onClick={() => voidIt.mutate(entry.id, { onSuccess: () => navigate(-1) })}>{t.entry.voidYes}</Button>
            <Button variant="outline" autoFocus onClick={() => setAskVoid(false)}>{t.entry.keepIt}</Button>
          </div>
        </div>
      )}
      {saved && <Toast>{t.entry.saved}</Toast>}
    </div>
  )
}

function show(field: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return t.entry.none
  if (field === 'amount_paise' && typeof v === 'number') return formatPaise(v)
  if (field === 'type' && typeof v === 'string') return t.entryTypes[v as EntryType] ?? v
  if (field === 'status' && typeof v === 'string') return t.status[v as Entry['status']] ?? v
  return String(v)
}

function History({ rows }: { rows: HistoryRow[] }) {
  return (
    <section>
      <h2 className="mb-4 t-label-lg">{t.entry.historyTitle}</h2>
      <ol className="border-b border-ink">
        {rows.map((h, i) => (
          <li key={i} className="grid gap-1 border-t border-ink py-4 app:grid-cols-[1fr_2fr] app:gap-4" data-testid="history-row">
            <div>
              <p className="t-label">{t.entry.actions[h.action] ?? h.action} · {shown(h.by)}</p>
              <p className="t-body">{formatWhen(h.at)}</p>
            </div>
            <ul className="t-body">
              {h.changes.filter((c) => h.action !== 'create' || ['amount_paise', 'type', 'party'].includes(c.field)).map((c) => (
                <li key={c.field}>
                  {t.entry.fields[c.field] ?? c.field}: {h.action === 'create' ? show(c.field, c.new) : `${show(c.field, c.old)} → ${show(c.field, c.new)}`}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </section>
  )
}
