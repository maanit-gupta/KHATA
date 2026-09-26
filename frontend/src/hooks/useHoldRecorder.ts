import { useRef, useState } from 'react'

const MAX_MS = 30_000
const MIN_MS = 700

type Phase = 'idle' | 'recording'

/** Hold-to-talk MediaRecorder: 30s hard cap (auto-sends), <0.7s is rejected via onTooShort. */
export function useHoldRecorder({ onAudio, onTooShort, onDenied }:
  { onAudio: (blob: Blob) => void; onTooShort: () => void; onDenied: () => void }) {
  const [phase, setPhase] = useState<Phase>('idle')
  const rec = useRef<MediaRecorder | null>(null)
  const started = useRef(0)
  const timer = useRef<number | undefined>(undefined)
  const released = useRef(false)

  async function start() {
    if (rec.current) return
    released.current = false
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      onDenied()
      return
    }
    if (released.current) { stream.getTracks().forEach((t) => t.stop()); onTooShort(); return }
    const r = new MediaRecorder(stream)
    const chunks: Blob[] = []
    r.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    r.onstop = () => {
      stream.getTracks().forEach((t) => t.stop())
      rec.current = null
      setPhase('idle')
      window.clearTimeout(timer.current)
      if (Date.now() - started.current < MIN_MS) return onTooShort()
      onAudio(new Blob(chunks, { type: r.mimeType || 'audio/webm' }))
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
