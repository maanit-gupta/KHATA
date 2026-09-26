import { useEffect, useRef, useState } from 'react'

export const MAX_MS = 30_000 // CLAUDE.md §6.1: hard cap, auto-sends
export const MIN_MS = 700 // shorter → "Hold the button while speaking."

type Phase = 'idle' | 'recording'

/**
 * Hold-to-talk MediaRecorder. Records whatever the browser produces (WebM/Opus on Chrome, MP4 on
 * Safari) and hands the Blob over as-is. 30 s hard cap (auto-sends); <0.7 s calls onTooShort;
 * no microphone (blocked, or no mediaDevices on an insecure origin) calls onDenied.
 */
export function useHoldRecorder({ onAudio, onTooShort, onDenied }:
  { onAudio: (blob: Blob) => void; onTooShort: () => void; onDenied: () => void }) {
  const [phase, setPhase] = useState<Phase>('idle')
  const rec = useRef<MediaRecorder | null>(null)
  const started = useRef(0)
  const timer = useRef<number | undefined>(undefined)
  const released = useRef(false)
  const handlers = useRef({ onAudio, onTooShort, onDenied })
  useEffect(() => { handlers.current = { onAudio, onTooShort, onDenied } })

  useEffect(() => () => {
    window.clearTimeout(timer.current)
    if (rec.current?.state === 'recording') rec.current.stop()
  }, [])

  async function start() {
    if (rec.current) return
    released.current = false
    let stream: MediaStream
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('no mic')
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      handlers.current.onDenied()
      return
    }
    if (released.current) { stream.getTracks().forEach((t) => t.stop()); handlers.current.onTooShort(); return }
    const r = new MediaRecorder(stream)
    const chunks: Blob[] = []
    r.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
    r.onstop = () => {
      stream.getTracks().forEach((t) => t.stop())
      rec.current = null
      setPhase('idle')
      window.clearTimeout(timer.current)
      if (Date.now() - started.current < MIN_MS) return handlers.current.onTooShort()
      handlers.current.onAudio(new Blob(chunks, { type: r.mimeType || 'audio/webm' }))
    }
    rec.current = r
    started.current = Date.now()
    r.start()
    setPhase('recording')
    timer.current = window.setTimeout(stop, MAX_MS)
  }

  function stop() {
    released.current = true
    if (rec.current?.state === 'recording') rec.current.stop()
  }

  return { phase, start, stop, maxMs: MAX_MS }
}
