import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState, type DragEvent, type FormEvent, type ReactNode } from 'react'
import { useSearchParams } from 'react-router'
import { Button, ButtonLink } from '../components/ui/Button'
import { SegmentChip } from '../components/ui/Chip'
import { Disclosure } from '../components/ui/Disclosure'
import { CategoryChips } from '../components/CategoryChips'
import { Field } from '../components/ui/Field'
import { RibbedGlass } from '../components/ui/RibbedGlass'
import { StatusSquare, type Status } from '../components/ui/StatusSquare'
import { Toast, ToastAction } from '../components/ui/Toast'
import { api } from '../lib/api'
import { todayIst } from '../lib/dates'
import { confirmEntry, useLedgerMutation, voidEntry, type Entry, type ExpenseCategory } from '../lib/ledger'
import { mediaUrl } from '../lib/media'
import { formatPaise } from '../lib/money'
import { PhotoError, preparePhoto, releasePhoto, rotatePhoto, type Prepared } from '../lib/photo'
import { useReceipt, type Kind, type Receipt } from '../lib/receipts'
import { t } from '../strings'
import { Screen } from './AppShell'

type SaveResult = { decision: 'auto' | 'confirm'; entry: Entry; suggestion: string | null }

const UNDO_MS = 5000
const TYPE_IT_IN_AFTER_MS = 90_000 // CLAUDE.md §6.3: 90 s, then offer to type it in (GOAL_2.0 P2.3)
const KINDS: Kind[] = ['supplier', 'customer', 'expense']
const ACCEPT = 'image/jpeg,image/png,image/heic,image/heif,.heic,.heif,application/pdf'

function uploadReceipt({ photo, kind, settled }: { photo: Prepared; kind: Kind; settled: boolean | null }) {
  const fd = new FormData()
  fd.append('image', photo.blob, photo.name)
  fd.append('kind', kind)
  if (settled !== null) fd.append('settled', String(settled))
  return api<{ receipt_id: string }>('/receipts', { method: 'POST', body: fd })
}

function settleLabel(kind: Kind, settled: boolean | null) {
  if (kind === 'expense' || settled === null) return ''
  return kind === 'supplier' ? (settled ? t.scan.paid : t.scan.credit) : (settled ? t.scan.cash : t.scan.udhaar)
}

/**
 * DESIGN.md §6.7, made to work (GOAL_2.0 P2): kind → settled → capture (camera, gallery, or drop a
 * file) → preview (turn, retake, a dark/small warning) → UPLOADING / READING THE BILL / CHECKING
 * with cancel and a 90 s "type it in instead" → review form (every field editable, kind too,
 * WHAT I READ) → saved, with ANOTHER BILL.
 */
export function ScanScreen() {
  const [params] = useSearchParams()
  const fromReview = params.get('receipt') // Review → ENTER MANUALLY: that bill's form, directly
  const [kind, setKind] = useState<Kind | null>(null)
  const [settled, setSettled] = useState<boolean | null>(null)
  const [photo, setPhoto] = useState<Prepared | null>(null)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const [receiptId, setReceiptId] = useState<string | null>(fromReview)
  const [typing, setTyping] = useState(false)
  const [result, setResult] = useState<SaveResult | null>(null)
  const upload = useMutation({ mutationFn: uploadReceipt })
  const receipt = useReceipt(receiptId)
  const photoRef = useRef<Prepared | null>(null)
  useEffect(() => { photoRef.current = photo }, [photo])
  useEffect(() => () => releasePhoto(photoRef.current), [])

  function reset() {
    releasePhoto(photo)
    setKind(null); setSettled(null); setPhoto(null); setPhotoError(null); setReceiptId(null)
    setTyping(false); setResult(null); upload.reset()
  }

  async function onFile(file: File | undefined) {
    if (!file) return
    setPhotoError(null)
    try {
      const next = await preparePhoto(file)
      releasePhoto(photo)
      setPhoto(next)
    } catch (e) {
      setPhotoError(e instanceof PhotoError ? t.scan.errors[e.code] : t.scan.errors.decode)
    }
  }

  function send() {
    if (!photo || !kind || upload.isPending) return
    upload.mutate({ photo, kind, settled: kind === 'expense' ? null : settled }, { onSuccess: (r) => setReceiptId(r.receipt_id) })
  }

  function cancelReading() {
    setReceiptId(null) // stop waiting; the photo stays for another try
    setTyping(false)
    upload.reset()
  }

  if (result) return <Saved result={result} onAnother={reset} />

  if (fromReview && receiptId === fromReview) {
    return (
      <Screen title={t.scan.checkHeading}>
        {receipt.error && <p className="t-body-lg" role="alert">{receipt.error.message}</p>}
        {receipt.data && <BillForm receipt={receipt.data} photo={null} onSaved={setResult} />}
      </Screen>
    )
  }

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

  const choice = `${t.scan[kind]}${settleLabel(kind, settled) && ` · ${settleLabel(kind, settled)}`}`

  if (!photo) {
    return (
      <Screen title={t.scan.photoHeading}>
        <p className="mb-6 t-label">{choice}</p>
        <Capture onFile={onFile} error={photoError} />
        <Button variant="text" className="mt-4 self-start" onClick={() => (kind === 'expense' ? setKind(null) : setSettled(null))}>{t.scan.back}</Button>
      </Screen>
    )
  }

  const r = receipt.data
  const reading = upload.isPending || (!!receiptId && !typing && (!r || r.status === 'queued' || r.status === 'processing'))

  if (!receiptId && !upload.isPending) {
    return (
      <Screen title={t.scan.previewHeading}>
        <p className="mb-6 t-label">{choice}</p>
        <div className="flex flex-col gap-4">
          <PhotoView photo={photo} />
          {(photo.dark || photo.small) && (
            <p className="flex items-start gap-3 t-body-lg" role="status" data-testid="photo-warning">
              <StatusSquare status="pending" className="mt-[6px]" />{t.scan.tooDarkOrSmall}
            </p>
          )}
          {photoError && <p className="t-body-lg" role="alert">{photoError}</p>}
          {upload.error && <p className="t-body-lg" role="alert">{upload.error.message}</p>}
          <Button onClick={send}>{t.scan.usePhoto}</Button>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" arrow={false} onClick={() => { releasePhoto(photo); setPhoto(null) }}>{t.scan.retake}</Button>
            {photo.kind === 'image' && (
              <Button variant="outline" arrow={false} onClick={() => rotatePhoto(photo).then(setPhoto).catch(() => setPhotoError(t.scan.errors.decode))}>
                {t.scan.rotate}
              </Button>
            )}
          </div>
        </div>
      </Screen>
    )
  }

  if (reading) {
    return (
      <Screen title={t.scan.readingHeading}>
        <p className="mb-6 t-label">{choice}</p>
        <Reading photo={photo} uploading={upload.isPending} receipt={r ?? null} error={receipt.error?.message ?? null}
          onCancel={cancelReading} onTypeItIn={receiptId ? () => setTyping(true) : null} />
      </Screen>
    )
  }

  return (
    <Screen title={t.scan.checkHeading}>
      {r && <BillForm receipt={r} photo={photo} onSaved={setResult} typed={typing} />}
    </Screen>
  )
}

/** Camera (phones open it directly), gallery or file pick, and drag-and-drop on a desktop. */
function Capture({ onFile, error }: { onFile: (f: File | undefined) => void; error: string | null }) {
  const [over, setOver] = useState(false)
  const coarse = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches
  const drop = (e: DragEvent) => { e.preventDefault(); setOver(false); onFile(e.dataTransfer.files?.[0]) }
  return (
    <div className="flex flex-col gap-3">
      <div
        data-testid="dropzone"
        onDragOver={(e) => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
        className={`flex flex-col gap-3 border border-ink p-4 transition-colors duration-200 ease-brand motion-ui ${over ? 'bg-bone' : 'bg-paper'}`}
      >
        <FilePick label={coarse ? t.scan.takePhoto : t.scan.chooseFile} accept={coarse ? 'image/*' : ACCEPT}
          capture={coarse ? 'environment' : undefined} onFile={onFile} primary />
        {!coarse && <p className="t-body">{t.scan.dropHere}</p>}
      </div>
      {coarse && <FilePick label={t.scan.fromGallery} accept={ACCEPT} onFile={onFile} />}
      <p className="t-body">{t.scan.photoHelp}</p>
      {error && <p className="t-body-lg" role="alert">{error}</p>}
    </div>
  )
}

function FilePick({ label, accept, capture, onFile, primary = false }:
  { label: string; accept: string; capture?: 'environment'; onFile: (f: File | undefined) => void; primary?: boolean }) {
  return (
    <label className={primary
      ? 'motion-ui group flex min-h-12 w-full cursor-pointer items-center justify-between bg-ink px-4 t-label-lg text-paper transition-colors duration-200 ease-brand hover:bg-black focus-within:bg-black focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ink'
      : 'inline-flex min-h-12 cursor-pointer items-center self-start t-label underline decoration-1 underline-offset-4 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ink'}>
      <span>{label}</span>
      {primary && <span aria-hidden className="motion-ui transition-transform duration-200 ease-brand group-hover:translate-x-1">{t.arrow}</span>}
      <input type="file" accept={accept} capture={capture} className="sr-only"
        onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = '' }} />
    </label>
  )
}

function PhotoView({ photo, children }: { photo: Prepared; children?: ReactNode }) {
  return (
    <div className="relative border border-ink" data-testid="photo-preview">
      {photo.kind === 'image' && photo.url
        ? <img src={photo.url} alt={t.scan.preview} className="block max-h-[70vh] w-full bg-mist object-contain" />
        : <p className="flex min-h-40 items-center gap-3 bg-mist gutter-x t-label-lg"><StatusSquare status="confirmed" />{t.scan.pdfFile(photo.name)}</p>}
      {children}
    </div>
  )
}

/** UPLOADING → READING THE BILL → CHECKING, each a square: done ink, current cyan, next outline. */
function Reading({ photo, uploading, receipt, error, onCancel, onTypeItIn }:
  { photo: Prepared; uploading: boolean; receipt: Receipt | null; error: string | null; onCancel: () => void; onTypeItIn: (() => void) | null }) {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    const id = window.setTimeout(() => setSlow(true), TYPE_IT_IN_AFTER_MS)
    return () => window.clearTimeout(id)
  }, [])
  const current = uploading ? 0 : receipt?.stage === 'checking' ? 2 : 1
  const steps = [t.scan.steps.uploading, t.scan.steps.reading, t.scan.steps.checking]
  const statusOf = (i: number): Status => (i < current ? 'confirmed' : i === current ? 'pending' : 'unselected')
  return (
    <div className="flex flex-col gap-6">
      <PhotoView photo={photo}>
        <RibbedGlass intensity="live" className="absolute inset-x-0 bottom-0 flex min-h-16 items-center gutter-x">
          <p className="t-label-lg" role="status" aria-live="polite">{steps[current]}…</p>
        </RibbedGlass>
      </PhotoView>
      <ol className="flex flex-col" data-testid="scan-steps">
        {steps.map((s, i) => (
          <li key={s} data-state={statusOf(i)} className="flex min-h-12 items-center gap-3 border-t border-ink t-label-lg last:border-b">
            <StatusSquare status={statusOf(i)} />{s}
          </li>
        ))}
      </ol>
      {error && <p className="t-body-lg" role="alert">{error}</p>}
      {slow && onTypeItIn && (
        <div className="flex flex-col gap-3">
          <p className="t-body-lg">{t.scan.slow}</p>
          <Button variant="outline" onClick={onTypeItIn}>{t.scan.typeItIn}</Button>
        </div>
      )}
      <Button variant="text" className="self-start" onClick={onCancel}>{t.scan.cancel}</Button>
    </div>
  )
}

/** The bill photo beside the form; tap to enlarge it for comparing (GOAL_2.0 P2.4). */
function Thumb({ photo, receiptId, fileType }: { photo: Prepared | null; receiptId: string; fileType: 'image' | 'pdf' }) {
  const [big, setBig] = useState(false)
  const stored = useQuery({ queryKey: ['bill-photo', receiptId], queryFn: () => mediaUrl('receipts', receiptId),
    enabled: !photo, staleTime: 5 * 60_000 })
  const src = photo?.url ?? (fileType === 'image' ? stored.data : null)
  if (photo?.kind === 'pdf' || (!photo && fileType === 'pdf')) {
    if (photo) return <p className="flex min-h-12 items-center gap-3 t-label"><StatusSquare status="confirmed" />{t.scan.pdfFile(photo.name)}</p>
    return stored.data
      ? <a href={stored.data} target="_blank" rel="noreferrer" className="inline-flex min-h-12 items-center gap-3 t-label underline decoration-1 underline-offset-4"><StatusSquare status="confirmed" />{t.scan.pdfFile('bill.pdf')}</a>
      : null
  }
  if (!src) return null
  return (
    <button type="button" onClick={() => setBig((b) => !b)} aria-expanded={big} aria-label={big ? t.scan.shrink : t.scan.enlarge}
      data-testid="bill-thumb" className="block w-full border border-ink bg-mist">
      <img src={src} alt={t.scan.preview} className={`block w-full object-contain ${big ? 'max-h-[85vh]' : 'max-h-40'}`} />
    </button>
  )
}

function BillForm({ receipt, photo, onSaved, typed = false }:
  { receipt: Receipt; photo: Prepared | null; onSaved: (r: SaveResult) => void; typed?: boolean }) {
  const [kind, setKind] = useState<Kind>(receipt.kind)
  const [settled, setSettled] = useState<boolean | null>(receipt.settled)
  const [vendor, setVendor] = useState(receipt.vendor_name ?? '')
  const [date, setDate] = useState(receipt.bill_date ?? todayIst())
  const [total, setTotal] = useState(receipt.total_paise != null ? String(receipt.total_paise / 100) : '')
  const [customer, setCustomer] = useState('')
  const [category, setCategory] = useState<ExpenseCategory | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const sent = useRef(false) // a second tap before the first answer can never send twice
  const needsCustomer = kind === 'customer' && settled === false
  const save = useLedgerMutation((body: object) =>
    api<SaveResult>(`/receipts/${receipt.receipt_id}/save`, { method: 'POST', body: JSON.stringify(body) }))

  function submit(ev: FormEvent) {
    ev.preventDefault()
    if (sent.current || save.isPending) return
    if (kind !== 'expense' && settled === null) {
      setFormError(kind === 'supplier' ? `${t.scan.paid} / ${t.scan.credit}?` : `${t.scan.cash} / ${t.scan.udhaar}?`)
      return
    }
    setFormError(null)
    sent.current = true
    const changedKind = kind !== receipt.kind || settled !== receipt.settled
    save.mutate(
      { vendor_name: vendor || undefined, bill_date: date || undefined, total_rupees: Number(total.replace(/,/g, '')),
        customer_name: needsCustomer ? customer : undefined, ...(changedKind ? { kind, settled: kind === 'expense' ? null : settled } : {}),
        ...(kind === 'expense' && category ? { expense_category: category } : {}) },
      { onSuccess: onSaved, onError: () => { sent.current = false } },
    )
  }

  const readFailed = receipt.status === 'failed' || typed
  const [yes, no] = kind === 'supplier' ? [t.scan.paid, t.scan.credit] : [t.scan.cash, t.scan.udhaar]
  return (
    <div className="grid gap-6 app:grid-cols-2 app:items-start">
      <div className="flex flex-col gap-4 app:sticky app:top-20">
        <Thumb photo={photo} receiptId={receipt.receipt_id} fileType={receipt.file_type ?? 'image'} />
        <Disclosure label={t.scan.whatIRead} testId="what-i-read">
          <p className="max-h-[50vh] overflow-y-auto t-body whitespace-pre-wrap break-words">{receipt.ocr_text?.trim() || t.scan.readNothing}</p>
        </Disclosure>
      </div>
      <form onSubmit={submit} className="on-dark flex flex-col gap-8 bg-ink p-6 text-paper app:p-8" data-testid="bill-form">
        {readFailed && <p className="t-body-lg" role="alert">{(!typed && receipt.error) || t.scan.typeByHand}</p>}
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 t-field-label">{t.scan.changeKind}</legend>
          <div className="grid grid-cols-3 gap-2">
            {KINDS.map((k) => (
              <SegmentChip key={k} dark selected={kind === k} onClick={() => {
                setKind(k)
                if (k === 'expense') setSettled(null)
              }}>{t.scan[k]}</SegmentChip>
            ))}
          </div>
          {kind !== 'expense' && (
            <div className="grid grid-cols-2 gap-2">
              <SegmentChip dark selected={settled === true} onClick={() => setSettled(true)}>{yes}</SegmentChip>
              <SegmentChip dark selected={settled === false} onClick={() => setSettled(false)}>{no}</SegmentChip>
            </div>
          )}
          {formError && <p className="t-body" role="alert">{formError}</p>}
        </fieldset>
        <Field dark label={t.scan.vendor} required={kind === 'supplier'} value={vendor} onChange={(e) => setVendor(e.target.value)}
          hint={receipt.vendor_name ? null : t.scan.notFound} />
        <Field dark label={t.scan.date} type="date" value={date} onChange={(e) => setDate(e.target.value)}
          hint={receipt.bill_date ? null : t.scan.dateNotFound} />
        <Field dark label={t.scan.total} required inputMode="decimal" autoComplete="off"
          value={total} onChange={(e) => setTotal(e.target.value)}
          hint={receipt.total_paise == null ? t.scan.notFound : receipt.total_check === 'check' ? t.scan.checkThis : null}
          hintTone={receipt.total_paise != null && receipt.total_check === 'check' ? 'check' : 'info'} />
        {kind === 'expense' && <CategoryChips dark value={category} onChange={setCategory} />}
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
        <div className="flex flex-col gap-2 border-t border-ink pt-6" data-testid="saved-entry">
          <p className="flex items-center gap-3 t-label"><StatusSquare status={entry.status} />{t.entryTypes[entry.type]} · {t.status[entry.status]}</p>
          <p className={`t-amount ${entry.status === 'voided' ? 'line-through' : ''}`}>{formatPaise(entry.amount_paise)}</p>
          <p className="t-h3">{who}</p>
        </div>
        {entry.status === 'pending' && (
          <div className="flex flex-col gap-3">
            {entry.review_reason && <p className="t-body-lg">{entry.review_reason}</p>}
            <p className="t-body">{t.scan.pending}</p>
            <Button disabled={confirm.isPending} onClick={() => confirm.mutate(entry.id, { onSuccess: setEntry })}>{t.ledger.confirm}</Button>
          </div>
        )}
        <Button onClick={onAnother}>{t.scan.another}</Button>
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
