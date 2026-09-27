import { useEffect, type KeyboardEvent } from 'react'
import { useHoldRecorder } from '../../hooks/useHoldRecorder'
import { t } from '../../strings'

type Props = {
  label: string
  /** ink = HOLD TO ADD; inverse = HOLD TO ASK / HOLD TO ANSWER (paper fill, ink hairline). */
  variant?: 'ink' | 'inverse'
  busy?: boolean
  onAudio: (blob: Blob) => void
  onTooShort: () => void
  onDenied: () => void
  onRecordingChange?: (recording: boolean) => void
  className?: string
}

/**
 * Hold-to-talk button (DESIGN.md §6.4). Press and hold (pointer, or Space/Enter from the
 * keyboard); release to send. While recording the button is ink, the label reads "LISTENING…
 * RELEASE TO SEND" and a hairline along the top edge draws over exactly 30 s, turning white at
 * 25 s. The hairline is CSS-animated, linear, and kept under reduced motion (it carries information).
 */
export function HoldButton({ label, variant = 'ink', busy = false, onAudio, onTooShort, onDenied, onRecordingChange, className = '' }: Props) {
  const rec = useHoldRecorder({ onAudio, onTooShort, onDenied })
  const recording = rec.phase === 'recording'
  useEffect(() => { onRecordingChange?.(recording) }, [recording, onRecordingChange])

  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); if (!busy) rec.start() }
  }
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); rec.stop() }
  }
  const tone = recording || variant === 'ink' ? 'bg-ink text-paper' : 'bg-paper text-ink border border-ink'
  return (
    <button
      type="button"
      disabled={busy}
      aria-live="polite"
      onPointerDown={(e) => { e.preventDefault(); if (!busy) rec.start() }}
      onPointerUp={rec.stop}
      onPointerLeave={() => recording && rec.stop()}
      onPointerCancel={() => recording && rec.stop()}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onContextMenu={(e) => e.preventDefault()}
      className={`relative flex min-h-[72px] w-full select-none items-center justify-between px-4 t-label-lg touch-none disabled:cursor-wait disabled:opacity-60 ${tone} ${className}`}
    >
      {recording && <span aria-hidden data-testid="record-countdown" className="countdown-record absolute inset-x-0 top-0 h-px" />}
      <span>{recording ? t.ledger.listening : busy ? t.ledger.working : label}</span>
      <span aria-hidden className={`size-[14px] ${recording || variant === 'ink' ? 'bg-paper' : 'bg-ink'}`} />
    </button>
  )
}
