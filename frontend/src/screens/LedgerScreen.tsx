import { motion } from 'framer-motion'
import { useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { Button } from '../components/ui/Button'
import { SegmentChip } from '../components/ui/Chip'
import { Field } from '../components/ui/Field'
import { H2 } from '../components/ui/H2'
import { RibbedGlass } from '../components/ui/RibbedGlass'
import { Row } from '../components/ui/Row'
import { Toast, ToastAction } from '../components/ui/Toast'
import { useHoldRecorder } from '../hooks/useHoldRecorder'
import { api } from '../lib/api'
import {
  confirmEntry, ENTRY_TYPES, NO_PARTY_TYPES, playB64, useEntries, useLedgerMutation, voidEntry,
  type Entry, type EntryType, type VoiceResult,
} from '../lib/ledger'
import { formatPaise } from '../lib/money'
import { t } from '../strings/en'

const UNDO_MS = 5000

type ToastState = { kind: 'saved'; entry: Entry } | { kind: 'text'; text: string } | null

function uploadVoice(blob: Blob) {
  const fd = new FormData()
  const ext = blob.type.includes('mp4') ? 'mp4' : 'webm'
  fd.append('audio', blob, `note.${ext}`)
  return api<VoiceResult>('/voice/entry', { method: 'POST', body: fd })
}

export function LedgerScreen() {
  const entries = useEntries()
  const [result, setResult] = useState<VoiceResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<ToastState>(null)
  const [showForm, setShowForm] = useState(false)
  const toastTimer = useRef<number | undefined>(undefined)

  function showToast(next: ToastState, ms: number) {
    window.clearTimeout(toastTimer.current)
    setToast(next)
    toastTimer.current = window.setTimeout(() => setToast(null), ms)
  }

  const voice = useLedgerMutation(uploadVoice)
  const confirm = useLedgerMutation(confirmEntry)
  const undo = useLedgerMutation(voidEntry)

  const rec = useHoldRecorder({
    onAudio: (blob) => {
      setError(null)
      voice.mutate(blob, {
        onSuccess: (r) => {
          setResult(r)
          playB64(r.audio_b64)
          if (r.decision === 'auto' && r.entry) showToast({ kind: 'saved', entry: r.entry }, UNDO_MS)
        },
        onError: (e) => setError(e.message),
      })
    },
    onTooShort: () => showToast({ kind: 'text', text: t.ledger.tooShort }, 2500),
    onDenied: () => setError(t.ledger.micDenied),
  })

  const recording = rec.phase === 'recording'
  const label = recording ? t.ledger.listening : voice.isPending ? t.ledger.working : t.ledger.holdToAdd

  return (
    <div className="grid app:grid-cols-3">
      <div className="app:sticky app:top-14 app:self-start">
        <RibbedGlass intensity={recording ? 'live' : 'idle'} className="flex min-h-[38vh] flex-col justify-end gap-3 gutter-x py-8">
          <button
            type="button"
            disabled={voice.isPending}
            onPointerDown={(e) => { e.preventDefault(); rec.start() }}
            onPointerUp={rec.stop}
            onPointerLeave={() => recording && rec.stop()}
            onContextMenu={(e) => e.preventDefault()}
            className="relative flex min-h-[72px] w-full select-none items-center justify-between bg-ink px-4 t-label-lg text-paper touch-none disabled:opacity-60"
          >
            {recording && (
              <motion.span
                aria-hidden
                className="absolute inset-x-0 top-0 h-px origin-left bg-cyan"
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: rec.maxMs / 1000, ease: 'linear' }}
              />
            )}
            <span>{label}</span>
            <span aria-hidden>●</span>
          </button>
          <Button variant="outline" onClick={() => setShowForm((s) => !s)}>
            {showForm ? t.ledger.closeForm : t.ledger.addByHand}
          </Button>
        </RibbedGlass>
      </div>

      <div className="flex flex-col gap-10 gutter-x py-10 app:col-span-2">
        {error && <p className="t-body-lg" role="alert">{error}</p>}
        {showForm && <ManualForm onDone={(entry) => { setShowForm(false); showToast({ kind: 'saved', entry }, UNDO_MS) }} />}
        {result && (
          <ResultCard
            result={result}
            confirming={confirm.isPending}
            onConfirm={(id) => confirm.mutate(id, { onSuccess: (entry) => setResult({ ...result, decision: 'auto', entry }) })}
            onVoid={(id) => undo.mutate(id, { onSuccess: () => setResult(null) })}
          />
        )}
        <section>
          <H2 lines={t.ledger.recent} className="mb-6" />
          <EntryList entries={entries.data} empty={t.ledger.empty} />
        </section>
      </div>

      {toast?.kind === 'saved' && (
        <Toast
          countdownMs={UNDO_MS}
          action={<ToastAction onClick={() => undo.mutate(toast.entry.id, { onSuccess: () => { setResult(null); showToast({ kind: 'text', text: t.toast.undone }, 1500) } })}>{t.toast.undo}</ToastAction>}
        >
          {t.ledger.saved(toast.entry.party_name ?? t.entryTypes[toast.entry.type], formatPaise(toast.entry.amount_paise))}
        </Toast>
      )}
      {toast?.kind === 'text' && <Toast>{toast.text}</Toast>}
    </div>
  )
}

function ResultCard({ result, confirming, onConfirm, onVoid }:
  { result: VoiceResult; confirming: boolean; onConfirm: (id: string) => void; onVoid: (id: string) => void }) {
  const e = result.entry
  return (
    <section className="border-t border-ink pt-6">
      {result.transcript_en && <p className="mb-4 t-body text-muted">{t.ledger.heard(result.transcript_en)}</p>}
      {e ? (
        <>
          <p className="t-amount">{formatPaise(e.amount_paise)}</p>
          <p className="t-h3">{e.party_name ?? t.ledger.noParty}</p>
          <p className="mt-2 t-label">{t.entryTypes[e.type]} · {t.status[e.status]}</p>
          {e.status === 'pending' && (
            <div className="mt-6 flex flex-col gap-3">
              {e.review_reason && <p className="t-body-lg">{e.review_reason}</p>}
              <Button disabled={confirming} onClick={() => onConfirm(e.id)}>{t.ledger.confirm}</Button>
              <Button variant="outline" onClick={() => onVoid(e.id)}>{t.ledger.voidIt}</Button>
            </div>
          )}
        </>
      ) : (
        <p className="t-body-lg">{result.speech_text}</p>
      )}
      {result.audio_b64 && (
        <button type="button" className="mt-4 min-h-12 t-label underline" onClick={() => playB64(result.audio_b64)}>{t.ledger.play}</button>
      )}
    </section>
  )
}

export function EntryList({ entries, empty }: { entries: Entry[] | undefined; empty: string }) {
  const navigate = useNavigate()
  if (!entries) return null
  if (!entries.length) return <p className="t-body-lg">{empty}</p>
  return (
    <div className="border-b border-ink">
      {entries.map((e, i) => (
        <Row
          key={e.id}
          index={i}
          status={e.status}
          auto={e.auto_saved}
          right={<span className="t-body-lg tabular-nums">{formatPaise(e.amount_paise)}</span>}
          onClick={e.party_id ? () => navigate(`/app/parties/${e.party_id}`) : undefined}
        >
          {e.party_name ?? t.entryTypes[e.type]}
          <span className="block t-label text-muted">{t.entryTypes[e.type]} · {e.occurred_on}</span>
        </Row>
      ))}
    </div>
  )
}

function ManualForm({ onDone }: { onDone: (e: Entry) => void }) {
  const [type, setType] = useState<EntryType>('credit_given')
  const [amount, setAmount] = useState('')
  const [party, setParty] = useState('')
  const [note, setNote] = useState('')
  const save = useLedgerMutation((body: object) => api<Entry>('/entries', { method: 'POST', body: JSON.stringify(body) }))
  const needsParty = !NO_PARTY_TYPES.includes(type)

  function submit(ev: FormEvent) {
    ev.preventDefault()
    save.mutate(
      { type, amount_rupees: Number(amount), party_name: needsParty ? party : undefined, note: note || undefined },
      { onSuccess: (e) => onDone(e as Entry) },
    )
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-6 border-t border-ink pt-6">
      <div>
        <p className="mb-2 t-field-label">{t.ledger.type}</p>
        <div className="flex flex-wrap gap-2">
          {ENTRY_TYPES.map((k) => (
            <SegmentChip key={k} selected={type === k} onClick={() => setType(k)}>{t.entryTypes[k]}</SegmentChip>
          ))}
        </div>
      </div>
      <Field label={t.ledger.amount} required inputMode="decimal" type="number" min="1" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} />
      {needsParty && <Field label={t.ledger.partyName} required value={party} onChange={(e) => setParty(e.target.value)} />}
      <Field label={t.ledger.note} value={note} onChange={(e) => setNote(e.target.value)} />
      {save.error && <p className="t-body" role="alert">{save.error.message}</p>}
      <Button type="submit" disabled={save.isPending}>{save.isPending ? t.ledger.working : t.ledger.save}</Button>
    </form>
  )
}
