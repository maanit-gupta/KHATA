import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { Button } from '../components/ui/Button'
import { SegmentChip } from '../components/ui/Chip'
import { Field } from '../components/ui/Field'
import { api } from '../lib/api'
import { useLedgerMutation, type Entry } from '../lib/ledger'
import { formatPaise } from '../lib/money'
import { t } from '../strings/en'
import { Screen } from './AppShell'

type Kind = 'supplier' | 'customer' | 'expense'
type Receipt = {
  receipt_id: string; status: 'done' | 'failed'; vendor_name: string | null
  bill_date: string | null; total_paise: number | null; error: string | null
}
type SaveResult = { decision: 'auto' | 'confirm'; entry: Entry; suggestion: string | null }

function uploadReceipt({ file, kind, settled }: { file: File; kind: Kind; settled: boolean | null }) {
  const fd = new FormData()
  fd.append('image', file)
  fd.append('kind', kind)
  if (settled !== null) fd.append('settled', String(settled))
  return api<Receipt>('/receipts', { method: 'POST', body: fd })
}

export function ScanScreen() {
  const [kind, setKind] = useState<Kind>('supplier')
  const [settled, setSettled] = useState<boolean | null>(null)
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const [vendor, setVendor] = useState('')
  const [date, setDate] = useState('')
  const [total, setTotal] = useState('')
  const [customer, setCustomer] = useState('')
  const [result, setResult] = useState<SaveResult | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const save = useLedgerMutation((body: object) =>
    api<SaveResult>(`/receipts/${receipt!.receipt_id}/save`, { method: 'POST', body: JSON.stringify(body) }))

  const ready = kind === 'expense' || settled !== null
  const needsCustomer = kind === 'customer' && settled === false

  async function onFile(file: File | undefined) {
    if (!file) return
    setUploading(true)
    setUploadError(null)
    try {
      const r = await uploadReceipt({ file, kind, settled: kind === 'expense' ? null : settled })
      setReceipt(r)
      setVendor(r.vendor_name ?? '')
      setDate(r.bill_date ?? '')
      setTotal(r.total_paise != null ? String(r.total_paise / 100) : '')
    } catch (e) {
      setUploadError((e as Error).message)
    } finally {
      setUploading(false)
    }
  }

  function submit(ev: FormEvent) {
    ev.preventDefault()
    save.mutate(
      { vendor_name: vendor || undefined, bill_date: date || undefined, total_rupees: Number(total),
        customer_name: needsCustomer ? customer : undefined },
      { onSuccess: (r) => setResult(r as SaveResult) },
    )
  }

  function reset() {
    setReceipt(null); setResult(null); setVendor(''); setDate(''); setTotal(''); setCustomer('')
    save.reset()
  }

  if (result) {
    return (
      <Screen title={t.screens.scan}>
        <div className="flex flex-col gap-6 border-t border-ink pt-6">
          <p className="t-body-lg">
            {t.entryTypes[result.entry.type]} · {result.entry.party_name ?? result.entry.note ?? t.ledger.noParty} · {formatPaise(result.entry.amount_paise)}
          </p>
          <p className="t-body">{result.decision === 'auto' ? t.scan.saved : t.scan.pending}</p>
          <Button onClick={reset}>{t.scan.another}</Button>
          <Link to="/app" className="t-label underline">{t.screens.ledger.join(' ')}</Link>
        </div>
      </Screen>
    )
  }

  return (
    <Screen title={t.screens.scan}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap gap-2">
          {(['supplier', 'customer', 'expense'] as Kind[]).map((k) => (
            <SegmentChip key={k} selected={kind === k} disabled={!!receipt}
              onClick={() => { setKind(k); setSettled(null) }}>{t.scan[k]}</SegmentChip>
          ))}
        </div>
        {kind !== 'expense' && (
          <div className="flex flex-wrap gap-2">
            <SegmentChip selected={settled === true} disabled={!!receipt} onClick={() => setSettled(true)}>
              {kind === 'supplier' ? t.scan.paid : t.scan.cash}
            </SegmentChip>
            <SegmentChip selected={settled === false} disabled={!!receipt} onClick={() => setSettled(false)}>
              {kind === 'supplier' ? t.scan.credit : t.scan.udhaar}
            </SegmentChip>
          </div>
        )}

        {ready && !receipt && (
          <div className="flex flex-col gap-2 border-t border-ink pt-6">
            <label className="t-field-label" htmlFor="bill-photo">{t.scan.photo}</label>
            <input id="bill-photo" type="file" accept="image/jpeg,image/png" disabled={uploading}
              className="t-body" onChange={(e) => onFile(e.target.files?.[0])} />
            {uploading && <p className="t-body-lg" role="status">{t.scan.reading}</p>}
            {uploadError && <p className="t-body" role="alert">{uploadError}</p>}
          </div>
        )}

        {receipt && (
          <form onSubmit={submit} className="flex flex-col gap-6 border-t border-ink pt-6">
            {receipt.status === 'failed' && <p className="t-body" role="alert">{receipt.error ?? t.scan.typeByHand}</p>}
            <Field label={t.scan.vendor} required={kind === 'supplier'} value={vendor} onChange={(e) => setVendor(e.target.value)} />
            <Field label={t.scan.date} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <Field label={t.scan.total} required inputMode="decimal" type="number" min="0.01" step="any" value={total} onChange={(e) => setTotal(e.target.value)} />
            {needsCustomer && <Field label={t.scan.customerName} required value={customer} onChange={(e) => setCustomer(e.target.value)} />}
            {save.error && <p className="t-body" role="alert">{save.error.message}</p>}
            <Button type="submit" disabled={save.isPending}>{save.isPending ? t.ledger.working : t.scan.save}</Button>
          </form>
        )}
      </div>
    </Screen>
  )
}
