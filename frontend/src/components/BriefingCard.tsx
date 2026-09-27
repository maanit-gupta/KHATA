import { useState } from 'react'
import { todayIst } from '../lib/dates'
import { playUrl } from '../lib/player'
import { briefingAudio, useBriefing } from '../lib/reports'
import { t } from '../strings'
import { Button } from './ui/Button'
import { PlayButton } from './ui/PlayButton'

const KEY = 'khata-briefing-closed'

function closedToday(): boolean {
  try { return localStorage.getItem(KEY) === todayIst() } catch { return false }
}

/**
 * GOAL_2.0 P7.4: "TODAY'S BRIEFING" on the first Home or Dashboard visit of the day, until closed.
 * Yesterday's figures, today's top tip and the review count, in the report language. Never
 * autoplays (browsers block audio without a tap); the audio is made once per language and voice.
 */
export function BriefingCard() {
  const [closed, setClosed] = useState(closedToday)
  const q = useBriefing(!closed)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (closed || !q.data) return null
  const b = q.data
  async function play() {
    setBusy(true); setError(null)
    try { await playUrl((await briefingAudio()).url) } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  function close() {
    try { localStorage.setItem(KEY, todayIst()) } catch { /* private mode: closed for this visit */ }
    setClosed(true)
  }
  return (
    <section aria-labelledby="briefing-title" className="on-dark flex flex-col gap-4 bg-ink p-6 text-paper app:p-8" data-testid="briefing-card">
      <div className="flex items-center justify-between gap-4">
        <h2 id="briefing-title" className="t-label-lg">{t.briefing.title}</h2>
        <Button variant="text" arrow={false} className="min-w-12 justify-center text-paper" onClick={close}>{t.briefing.close}</Button>
      </div>
      <div className="flex items-start gap-4">
        <PlayButton dark onClick={play} disabled={busy} label={t.briefing.play} />
        <p className="t-body-lg" lang={b.lang} data-testid="briefing-text">{b.text}</p>
      </div>
      {error && <p className="t-body" role="alert">{error}</p>}
    </section>
  )
}
