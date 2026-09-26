import { useEffect, useRef } from 'react'
import { Button } from './ui/Button'
import { H2 } from './ui/H2'
import { t } from '../strings/en'

/** CLAUDE.md §8: microphone permission denied → an instruction screen, not a one-line error. */
export function MicBlocked({ onRetry, onClose }: { onRetry: () => void; onClose: () => void }) {
  const retry = useRef<HTMLButtonElement>(null)
  useEffect(() => { retry.current?.focus() }, [])
  return (
    <div role="alertdialog" aria-modal="true" aria-labelledby="mic-title"
      className="on-dark fixed inset-0 z-[70] flex flex-col justify-end overflow-y-auto bg-ink gutter-x pb-10 pt-20 text-paper">
      <div className="flex max-w-[640px] flex-col gap-8">
        <div id="mic-title"><H2 lines={t.mic.heading} /></div>
        <p className="t-body-lg">{t.mic.lead}</p>
        <ol className="flex flex-col">
          {t.mic.steps.map((s, i) => (
            <li key={s} className="flex gap-4 border-t border-[var(--hairline-dark)] py-4 t-body-lg">
              <span className="w-6 shrink-0 tabular-nums">{i + 1}.</span><span>{s}</span>
            </li>
          ))}
        </ol>
        <div className="flex flex-col gap-3">
          <Button ref={retry} variant="inverse" onClick={onRetry}>{t.mic.retry}</Button>
          <Button variant="text" className="self-start text-paper" onClick={onClose}>{t.mic.close}</Button>
        </div>
      </div>
    </div>
  )
}
