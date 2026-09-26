import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Button, ButtonLink } from '../components/ui/Button'
import { SegmentChip } from '../components/ui/Chip'
import { Field } from '../components/ui/Field'
import { RibbedGlass } from '../components/ui/RibbedGlass'
import { StatusSquare } from '../components/ui/StatusSquare'
import { Toast, ToastAction } from '../components/ui/Toast'
import { api } from '../lib/api'
import { confirmEntry, useLedgerMutation, voidEntry, type Entry } from '../lib/ledger'
import { formatPaise } from '../lib/money'
import { t } from '../strings/en'
import { Screen } from './AppShell'

type Kind = 'supplier' | 'customer' | 'expense'
export type Receipt = {
  receipt_id: string; status: 'queued' | 'processing' | 'done' | 'failed'; kind: Kind; settled: boolean | null
  vendor_name: string | null; bill_date: string | null; total_paise: number | null
  retried_in_english: boolean; error: string | null
}
type SaveResult = { decision: 'auto' | 'confirm'; entry: Entry; suggestion: string | null }

const POLL_MS = 2000 // CLAUDE.md §6.3: the frontend polls GET /receipts/{id} every 2 s
const UNDO_MS = 5000
const KINDS: Kind[] = ['supplier', 'customer', 'expense']

function uploadReceipt({ file, kind, settled }: { file: File; kind: Kind; settled: boolean | null }) {
  const fd = new FormData()
  fd.append('image', file)
  fd.append('kind', kind)
  if (settled !== null) fd.append('settled', String(settled))
  return api<{ receipt_id: string }>('/receipts', { method: 'POST', body: fd })
}

/** Polls a receipt every 2 s until OCR finishes (done or failed). */
export function useReceipt(id: string | null) {
  return useQuery({
    queryKey: ['receipt', id],
    queryFn: () => api<Receipt>(`/receipts/${id}`),
    enabled: !!id,
    refetchInterval: (q) => (q.state.data && ['done', 'failed'].includes(q.state.data.status) ? false : POLL_MS),
  })
}

/** DESIGN.md §6.7: kind → settled → photo (reading strip) → editable dark form → saved. */
export function ScanScreen() {
  const [kind, setKind] = useState<Kind | null>(null)
  const [settled, setSettled] = useState<boolean | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [receiptId, setReceiptId] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState<SaveResult | null>(null)
  const receipt = useReceipt(receiptId)

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  function reset() {
    setKind(null); setSettled(null); setReceiptId(null); setResult(null); setUploadError(null)
    setPreview(null)
  }

  async function onFile(file: File | undefined) {
    if (!file || !kind) return
    setPreview(URL.createObjectURL(file))
    setUploading(true)
    setUploadError(null)
    try {
      const r = await uploadReceipt({ file, kind, settled: kind === 'expense' ? null : settled })
      setReceiptId(r.receipt_id)
    } catch (e) {
      setUploadError((e as Error).message)
      setPreview(null)
    } finally {
      setUploading(false)
    }
  }

  if (result) return <Saved result={result} onAnother={reset} />

  if (!kind) {
    return (
      <Screen title={t.scan.kindHeading}>
        <div className="grid gap-px border border-ink bg-ink app:grid-cols-3">
          {KINDS.map((k) => (
            <button key={k} type="button" onClick={() => { setKind(k); setSettled(null) }}
              className="relative flex min-h-[200px] flex-col justify-between bg-paper p-5 text-left transition-colors duration-200 ease-brand hover:bg-bone motion-ui app:min-h-[280px]">
              <span className="t-h3 uppercase">{t.scan[k]}</span>
              <span aria-hidden className="absolute right-5 top-5 size-[10px] bg-ink" />
              <span className="t-body">{t.scan.kindHelp[k]}</span>
            </button>
          ))}
        </div>
      </Screen>
    )
  }

  if (kind !== 'expense' && settled === null) {
    const [yes, no] = kind === 'supplier' ? [t.scan.paid, t.scan.credit] : [t.scan.cash, t.scan.udhaar]
    return (
      <Screen title={t.scan.settleHeading}>
        <p className="mb-6 t-label">{t.scan[kind]}</p>
        <div className="grid grid-cols-2 gap-2">
          <SegmentChip selected={false} className="min-h-[96px] t-label-lg" onClick={() => setSettled(true)}>{yes}</SegmentChip>
          <SegmentChip selected={false} className="min-h-[96px] t-label-lg" onClick={() => setSettled(false)}>{no}</SegmentChip>
        </div>
        <Button variant="text" className="mt-6" onClick={() => setKind(null)}>{t.scan.back}</Button>
      </Screen>
    )
  }

  const r = receipt.data
  const reading = uploading || (!!receiptId && (!r || r.status === 'queued' || r.status === 'processing'))

  if (!receiptId || reading) {
    return (
      <Screen title={t.scan.photoHeading}>
        <p className="mb-6 t-label">{t.scan[kind]}{settled !== null && ` · ${kind === 'supplier' ? (settled ? t.scan.paid : t.scan.credit) : (settled ? t.scan.cash : t.scan.udhaar)}`}</p>
        {preview ? (
          <div className="relative border border-ink">
            <img src={preview} alt={t.scan.preview} className="block max-h-[70vh] w-full object-contain bg-mist" />
            {reading && (
              <RibbedGlass intensity="live" className="absolute inset-x-0 bottom-0 flex min-h-16 items-center gutter-x">
                <p className="t-label-lg" role="status" aria-live="polite">{t.scan.reading}</p>
              </RibbedGlass>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <label
              className="motion-ui group flex min-h-12 w-full cursor-pointer items-center justify-between bg-ink px-4 t-label-lg text-paper transition-colors duration-200 ease-brand hover:bg-black focus-within:bg-black focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ink">
              <span>{t.scan.photo}</span>
              <span aria-hidden className="motion-ui transition-transform duration-200 ease-brand group-hover:translate-x-1">{t.arrow}</span>
              <input type="file" accept="image/jpeg,image/png" className="sr-only"
                onChange={(e) => onFile(e.target.files?.[0])} />
            </label>
            <p className="t-body">{t.scan.photoHelp}</p>
            {uploadError && <p className="t-body" role="alert">{uploadError}</p>}
            <Button variant="text" className="self-start" onClick={() => (kind === 'expense' ? setKind(null) : setSettled(null))}>{t.scan.back}</Button>
          </div>
        )}
        {receipt.error && <p className="mt-4 t-body" role="alert">{receipt.error.message}</p>}
      </Screen>
    )
  }

  return (
    <Screen title={t.scan.checkHeading}>
      {r && <BillForm receipt={r} preview={preview} onSaved={setResult} />}
    </Screen>
  )
}

function BillForm({ receipt, preview, onSaved }: { receipt: Receipt; preview: string | null; onSaved: (r: SaveResult) => void }) {
  const [vendor, setVendor] = useState(receipt.vendor_name ?? '')
  const [date, setDate] = useState(receipt.bill_date ?? '')
  const [total, setTotal] = useState(receipt.total_paise != null ? String(receipt.total_paise / 100) : '')
  const [customer, setCustomer] = useState('')
  const needsCustomer = receipt.kind === 'customer' && receipt.settled === false
  const save = useLedgerMutation((body: object) =>
    api<SaveResult>(`/receipts/${receipt.receipt_id}/save`, { method: 'POST', body: JSON.stringify(body) }))

  function submit(ev: FormEvent) {
    ev.preventDefault()
    save.mutate(
      { vendor_name: vendor || undefined, bill_date: date || undefined, total_rupees: Number(total),
        customer_name: needsCustomer ? customer : undefined },
      { onSuccess: onSaved },
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {preview && <img src={preview} alt={t.scan.preview} className="block max-h-[40vh] w-full border border-ink bg-mist object-contain" />}
      <form onSubmit={submit} className="on-dark flex flex-col gap-8 bg-ink p-6 text-paper app:p-10">
        {receipt.status === 'failed' && <p className="t-body-lg" role="alert">{receipt.error ?? t.scan.typeByHand}</p>}
        <Field dark label={t.scan.vendor} required={receipt.kind === 'supplier'} value={vendor} onChange={(e) => setVendor(e.target.value)} />
        <Field dark label={t.scan.date} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <Field dark label={t.scan.total} required inputMode="decimal" type="number" min="0.01" step="0.01" value={total} onChange={(e) => setTotal(e.target.value)} />
        {needsCustomer && <Field dark label={t.scan.customerName} required value={customer} onChange={(e) => setCustomer(e.target.value)} />}
        {save.error && <p className="t-body" role="alert">{save.error.message}</p>}
        <Button type="submit" variant="inverse" disabled={save.isPending}>{save.isPending ? t.ledger.working : t.scan.save}</Button>
      </form>
    </div>
  )
}

function Saved({ result, onAnother }: { result: SaveResult; onAnother: () => void }) {
  const [entry, setEntry] = useState(result.entry)
  const [toast, setToast] = useState<'undo' | 'undone' | null>(result.decision === 'auto' ? 'undo' : null)
  const timer = useRef<number | undefined>(undefined)
  const confirm = useLedgerMutation(confirmEntry)
  const undo = useLedgerMutation(voidEntry)

  useEffect(() => {
    if (!toast) return
    timer.current = window.setTimeout(() => setToast(null), toast === 'undo' ? UNDO_MS : 1500)
    return () => window.clearTimeout(timer.current)
  }, [toast])

  const who = entry.party_name ?? entry.note ?? t.entryTypes[entry.type]
  return (
    <Screen title={t.scan.doneHeading}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2 border-t border-ink pt-6">
          <p className="flex items-center gap-3 t-label"><StatusSquare status={entry.status} />{t.entryTypes[entry.type]} · {t.status[entry.status]}</p>
          <p className="t-amount">{formatPaise(entry.amount_paise)}</p>
          <p className="t-h3">{who}</p>
        </div>
        {entry.status === 'pending' && (
          <div className="flex flex-col gap-3">
            {entry.review_reason && <p className="t-body-lg">{entry.review_reason}</p>}
            <p className="t-body">{t.scan.pending}</p>
            <Button disabled={confirm.isPending} onClick={() => confirm.mutate(entry.id, { onSuccess: setEntry })}>{t.ledger.confirm}</Button>
          </div>
        )}
        <Button variant="outline" onClick={onAnother}>{t.scan.another}</Button>
        <ButtonLink to="/app" variant="outline">{t.scan.toLedger}</ButtonLink>
      </div>
      {toast === 'undo' && (
        <Toast countdownMs={UNDO_MS}
          action={<ToastAction onClick={() => undo.mutate(entry.id, { onSuccess: (e) => { setEntry(e); setToast('undone') } })}>{t.toast.undo}</ToastAction>}>
          {t.ledger.saved(who, formatPaise(entry.amount_paise))}
        </Toast>
      )}
      {toast === 'undone' && <Toast>{t.toast.undone}</Toast>}
    </Screen>
  )
}
