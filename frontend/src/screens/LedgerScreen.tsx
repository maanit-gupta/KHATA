import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { EntryList } from '../components/EntryList'
import { ManualAdd } from '../components/ManualAdd'
import { MicBlocked } from '../components/MicBlocked'
import { BriefingCard } from '../components/BriefingCard'
import { WeeklyCard } from '../components/WeeklyCard'
import { Button, ButtonLink } from '../components/ui/Button'
import { Disclosure } from '../components/ui/Disclosure'
import { SegmentChip } from '../components/ui/Chip'
import { H2 } from '../components/ui/H2'
import { HoldButton } from '../components/ui/HoldButton'
import { PixelSquares } from '../components/ui/PixelSquares'
import { PlayButton } from '../components/ui/PlayButton'
import { RibbedGlass } from '../components/ui/RibbedGlass'
import { StatusSquare } from '../components/ui/StatusSquare'
import { Toast, ToastAction } from '../components/ui/Toast'
import {
  confirmEntry, playB64, reasonText, useEntries, useLedgerMutation, voidEntry,
  type Entry, type VoiceResult,
} from '../lib/ledger'
import { formatPaise } from '../lib/money'
import { resolveVoiceEntry, uploadVoiceEntry, uploadVoiceQuestion, type Answer } from '../lib/voice'
import { t } from '../strings'

const UNDO_MS = 5000 // DESIGN.md §6.5

type Result = { kind: 'entry'; data: VoiceResult } | { kind: 'answer'; data: Answer } | null
type ToastState = { kind: 'saved'; entry: Entry } | { kind: 'text'; text: string } | null

export function LedgerScreen() {
  const entries = useEntries()
  const [result, setResult] = useState<Result>(null)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<ToastState>(null)
  const [showForm, setShowForm] = useState(false)
  const [micBlocked, setMicBlocked] = useState(false)
  const [recording, setRecording] = useState<'add' | 'ask' | 'answer' | null>(null)
  const toastTimer = useRef<number | undefined>(undefined)

  const showToast = useCallback((next: ToastState, ms: number) => {
    window.clearTimeout(toastTimer.current)
    setToast(next)
    toastTimer.current = window.setTimeout(() => setToast(null), ms)
  }, [])
  useEffect(() => () => window.clearTimeout(toastTimer.current), [])

  const addVoice = useLedgerMutation(uploadVoiceEntry)
  const resolve = useLedgerMutation(resolveVoiceEntry)
  const ask = useLedgerMutation(uploadVoiceQuestion)
  const confirm = useLedgerMutation(confirmEntry)
  const undo = useLedgerMutation(voidEntry)

  function onEntryResult(r: VoiceResult) {
    setResult({ kind: 'entry', data: r })
    playB64(r.audio_b64)
    if (r.decision === 'auto' && r.entry) showToast({ kind: 'saved', entry: r.entry }, UNDO_MS)
  }
  const onError = (e: Error) => setError(e.message)
  const tooShort = useCallback(() => showToast({ kind: 'text', text: t.ledger.tooShort }, 2500), [showToast])
  const denied = useCallback(() => setMicBlocked(true), [])

  function sendEntry(blob: Blob, answerTo?: string) {
    setError(null)
    addVoice.mutate({ blob, answerTo }, { onSuccess: onEntryResult, onError })
  }
  function sendQuestion(blob: Blob) {
    setError(null)
    ask.mutate(blob, {
      onSuccess: (a) => { setResult({ kind: 'answer', data: a }); playB64(a.audio_b64) },
      onError,
    })
  }

  const busy = addVoice.isPending || ask.isPending || resolve.isPending
  const onRecAdd = useCallback((r: boolean) => setRecording((c) => (r ? 'add' : c === 'add' ? null : c)), [])
  const onRecAsk = useCallback((r: boolean) => setRecording((c) => (r ? 'ask' : c === 'ask' ? null : c)), [])
  const onRecAnswer = useCallback((r: boolean) => setRecording((c) => (r ? 'answer' : c === 'answer' ? null : c)), [])

  return (
    <div className="grid app:grid-cols-3">
      <div className="app:sticky app:top-14 app:self-start">
        <RibbedGlass intensity={recording ? 'live' : 'idle'} className="flex min-h-[38vh] flex-col justify-end gap-3 gutter-x py-8">
          <HoldButton label={t.ledger.holdToAdd} busy={busy} onAudio={(b) => sendEntry(b)}
            onTooShort={tooShort} onDenied={denied} onRecordingChange={onRecAdd} />
          <HoldButton label={t.ledger.holdToAsk} variant="inverse" busy={busy} onAudio={sendQuestion}
            onTooShort={tooShort} onDenied={denied} onRecordingChange={onRecAsk} />
          <ButtonLink to="/app/scan">{t.ledger.scanBill}</ButtonLink>
        </RibbedGlass>
      </div>

      <div className="flex flex-col gap-10 gutter-x py-10 app:col-span-2">
        {error && <p className="t-body-lg" role="alert">{error}</p>}
        <div aria-live="polite" className="empty:-mb-10">
          {result?.kind === 'entry' && (
            <EntryResult
              result={result.data}
              busy={busy || confirm.isPending}
              onResolve={(choice) => resolve.mutate({ voiceNoteId: result.data.voice_note_id, choice }, { onSuccess: onEntryResult, onError })}
              onConfirm={(id) => confirm.mutate(id, {
                onSuccess: (entry) => setResult({ kind: 'entry', data: { ...result.data, decision: 'auto', entry } }),
                onError,
              })}
              answer={(b) => sendEntry(b, result.data.voice_note_id)}
              onTooShort={tooShort} onDenied={denied} onRecordingChange={onRecAnswer}
            />
          )}
          {result?.kind === 'answer' && <AnswerCard answer={result.data} />}
        </div>

        <BriefingCard />
        <WeeklyCard />

        <section>
          <div className="mb-6 flex items-end justify-between gap-4">
            <H2 lines={t.ledger.recent} />
            <Button variant="text" onClick={() => setShowForm((s) => !s)} aria-expanded={showForm}>
              {showForm ? t.ledger.closeForm : t.ledger.addByHand}
            </Button>
          </div>
          {showForm && <div className="mb-8"><ManualAdd onSaved={(entry) => showToast({ kind: 'saved', entry }, UNDO_MS)} /></div>}
          {entries.error && <p className="t-body-lg" role="alert">{entries.error.message}</p>}
          <EntryList entries={entries.data} revealKey="ledger-recent" empty={<EmptyLedger />} />
        </section>
      </div>

      {toast?.kind === 'saved' && (
        <Toast
          countdownMs={UNDO_MS}
          action={<ToastAction onClick={() => undo.mutate(toast.entry.id, {
            onSuccess: () => { setResult(null); showToast({ kind: 'text', text: t.toast.undone }, 1500) },
            onError,
          })}>{t.toast.undo}</ToastAction>}
        >
          {t.ledger.saved(toast.entry.party_name ?? toast.entry.note ?? t.entryTypes[toast.entry.type], formatPaise(toast.entry.amount_paise))}
        </Toast>
      )}
      {toast?.kind === 'text' && <Toast>{toast.text}</Toast>}
      {micBlocked && <MicBlocked onClose={() => setMicBlocked(false)} onRetry={() => {
        setMicBlocked(false)
        navigator.mediaDevices?.getUserMedia({ audio: true })
          .then((s) => s.getTracks().forEach((tr) => tr.stop()))
          .catch(() => setMicBlocked(true))
      }} />}
    </div>
  )
}

function EmptyLedger() {
  return (
    <div className="relative min-h-[240px] border-t border-ink pt-6">
      <p className="relative z-10 max-w-md t-body-lg">{t.ledger.empty[0]}<br />{t.ledger.empty[1]}</p>
      <PixelSquares pattern={42} count={7} className="top-24" />
    </div>
  )
}

type EntryResultProps = {
  result: VoiceResult
  busy: boolean
  onResolve: (choice: 'use_suggested' | 'create_new') => void
  onConfirm: (id: string) => void
  answer: (blob: Blob) => void
  onTooShort: () => void
  onDenied: () => void
  onRecordingChange: (recording: boolean) => void
}

/** DESIGN.md §6.3 entry card + §6.6 pending / did-you-mean / clarify cards. */
function EntryResult({ result, busy, onResolve, onConfirm, answer, onTooShort, onDenied, onRecordingChange }: EntryResultProps) {
  const navigate = useNavigate()
  const e = result.entry
  return (
    <section className="border-t border-ink pt-6" data-testid="result-card">
      {e ? (
        <>
          <p className="flex items-center gap-3 t-label">
            <StatusSquare status={e.status} />
            {t.entryTypes[e.type]} · {t.status[e.status]}
            {e.auto_saved && e.status === 'confirmed' && <span>· {t.status.auto}</span>}
          </p>
          <p className="mt-3 t-amount">{formatPaise(e.amount_paise)}</p>
          <p className="t-h3">{e.party_name ?? e.note ?? t.ledger.noParty}</p>
          {e.status === 'pending' && (
            <div className="mt-6 flex flex-col gap-3">
              <p className="t-body-lg">{result.suggestion ? t.ledger.didYouMean(result.suggestion) : reasonText(e.review_reason)}</p>
              {result.suggestion ? (
                <div className="grid grid-cols-2 gap-2">
                  <SegmentChip selected disabled={busy} onClick={() => onResolve('use_suggested')}>{t.ledger.yesName(result.suggestion)}</SegmentChip>
                  <SegmentChip selected={false} disabled={busy} onClick={() => onResolve('create_new')}>{t.ledger.noNewPerson}</SegmentChip>
                </div>
              ) : (
                <>
                  <Button disabled={busy} onClick={() => onConfirm(e.id)}>{t.ledger.confirm}</Button>
                  <Button variant="outline" onClick={() => navigate(`/app/entries/${e.id}`)}>{t.ledger.edit}</Button>
                </>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="t-body-lg">{result.speech_text}</p>
          <HoldButton label={t.ledger.holdToAnswer} variant="inverse" busy={busy} onAudio={answer}
            onTooShort={onTooShort} onDenied={onDenied} onRecordingChange={onRecordingChange} />
        </div>
      )}
      {e && <p className="mt-4 t-body">{result.speech_text}</p>}
      {result.audio_b64 && <div className="mt-4"><PlayButton onClick={() => playB64(result.audio_b64)} /></div>}
      <div className="mt-4"><Heard raw={result.stt_raw ?? result.transcript_en} /></div>
    </section>
  )
}

function AnswerCard({ answer }: { answer: Answer }) {
  return (
    <section className="border-t border-ink pt-6" data-testid="answer-card">
      <div className="flex items-start gap-4">
        {answer.audio_b64 && <PlayButton onClick={() => playB64(answer.audio_b64)} />}
        <p className="t-body-lg">{answer.text}</p>
      </div>
      <div className="mt-4"><Heard raw={answer.stt_raw ?? answer.question_en} /></div>
    </section>
  )
}

/** GOAL_2.0 P1.3: the raw transcript, so the shopkeeper can see exactly what was heard. */
function Heard({ raw }: { raw: string | null | undefined }) {
  const text = (raw ?? '').trim()
  return (
    <Disclosure label={t.ledger.whatIHeard} testId="what-i-heard">
      <p className="t-body whitespace-pre-wrap">{text ? `“${text}”` : t.ledger.heardNothing}</p>
    </Disclosure>
  )
}
