import { useState } from 'react'
import { useNavigate } from 'react-router'
import { api } from '../lib/api'
import { useWeekly, type WeekFigures } from '../lib/insights'
import { balanceText, playB64 } from '../lib/ledger'
import { formatPaise } from '../lib/money'
import { t } from '../strings'
import { H2 } from './ui/H2'
import { PlayButton } from './ui/PlayButton'
import { Row } from './ui/Row'

const FIGURES: [keyof WeekFigures, 'cash' | 'credit' | 'collected' | 'expenses'][] = [
  ['cash_sales_paise', 'cash'], ['credit_given_paise', 'credit'],
  ['collected_paise', 'collected'], ['expenses_paise', 'expenses'],
]

/** DESIGN.md §6.3 "This week, so far.": 4 figure rows vs last week, the narration with a play
 * control, and the top 3 debtors as Rows. Numbers come from SQL; the text is only phrasing. */
export function WeeklyCard() {
  const q = useWeekly()
  const navigate = useNavigate()
  const [playing, setPlaying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (q.isPending) return null
  if (q.error) return <p className="t-body" role="alert">{q.error.message}</p>
  const w = q.data

  async function play() {
    setPlaying(true); setError(null)
    try {
      const r = await api<{ audio_b64: string | null }>('/tts', { method: 'POST', body: JSON.stringify({ text: w.narration_en, purpose: 'report' }) })
      playB64(r.audio_b64)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setPlaying(false)
    }
  }

  return (
    <section className="bg-mist p-6 app:p-10" data-testid="weekly-card" aria-labelledby="week-title">
      <div id="week-title"><H2 lines={t.week.heading} /></div>
      <dl className="mt-8 border-b border-ink">
        {FIGURES.map(([key, label]) => (
          <div key={key} className="grid grid-cols-[1fr_auto] items-baseline gap-x-4 gap-y-1 border-t border-ink py-4">
            <dt className="t-label">{t.week[label]}</dt>
            <dd className="t-amount text-right">{formatPaise(w.this_week[key])}</dd>
            <dd className="col-span-2 t-body">{t.week.lastWeek(formatPaise(w.last_week[key]))}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-6 flex items-start gap-4">
        <PlayButton onClick={play} disabled={playing} label={t.week.play} />
        <p className="t-body-lg" aria-live="polite">{w.narration}</p>
      </div>
      {error && <p className="mt-2 t-body" role="alert">{error}</p>}
      {w.top_debtors.length > 0 && (
        <div className="mt-8">
          <h3 className="mb-2 t-label">{t.week.debtors}</h3>
          <div className="border-b border-ink">
            {w.top_debtors.map((d, i) => (
              <Row key={d.party_id} index={i} status="confirmed" onClick={() => navigate(`/app/parties/${d.party_id}`)}
                right={<span className="t-label">{balanceText(d.balance_paise)}</span>}>
                {d.name}
                <span className="block t-label">{t.week.days(d.days_since_last_activity)}</span>
              </Row>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
