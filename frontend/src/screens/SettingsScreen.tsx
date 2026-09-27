import { useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useMe } from '../auth/hooks'
import { Button } from '../components/ui/Button'
import { ChipButton } from '../components/ui/Chip'
import { Field } from '../components/ui/Field'
import { Row } from '../components/ui/Row'
import { StatusSquare } from '../components/ui/StatusSquare'
import { api, type Membership } from '../lib/api'
import { formatDay } from '../lib/dates'
import { playB64 } from '../lib/ledger'
import { shown, useMembers } from '../lib/members'
import { supabase } from '../lib/supabase'
import { DEFAULT_VOICE, voicesFor } from '../lib/voices'
import { LANG_ORDER, t, type Lang } from '../strings'
import { Screen } from './AppShell'

type Aspect = 'ui_lang' | 'lang' | 'voice_lang' | 'report_lang'
type Patch = Partial<Pick<Membership, Aspect | 'tts_voice' | 'display_name' | 'speech_auto'>>

/**
 * DESIGN.md §6.12: Languages (GOAL_2.0 P5.1: one per aspect, each in its own script), Voice (plays a
 * sample in the read-back language), Shop invite code (COPY), LOG OUT, my name, the members.
 */
export function SettingsScreen() {
  const me = useMe()
  const qc = useQueryClient()
  const [open, setOpen] = useState<Aspect | 'voice' | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const m = me.data?.membership
  const shop = me.data?.shop
  if (!m || !shop) return <Screen title={t.screens.settings} />
  const lang = m.lang as Lang
  const current: Record<Aspect, Lang> = {
    ui_lang: (m.ui_lang ?? lang) as Lang, lang, voice_lang: (m.voice_lang ?? lang) as Lang, report_lang: (m.report_lang ?? lang) as Lang,
  }
  const voiceLang = current.voice_lang
  const voice = m.tts_voice ?? DEFAULT_VOICE[voiceLang]
  const L = t.settings.languages

  async function patch(body: Patch) {
    const next = await api<Membership>('/me', { method: 'PATCH', body: JSON.stringify(body) })
    // The app root watches this and switches the on-screen language when ui_lang changes (main.tsx).
    qc.setQueryData(['me', me.data!.user.id], { ...me.data!, membership: next })
    qc.invalidateQueries({ queryKey: ['insights'] })
    return next
  }

  async function run(key: string, body: Patch) {
    setError(null); setBusy(key)
    try { await patch(body) } catch (e) { setError((e as Error).message) } finally { setBusy(null) }
  }

  async function pickVoice(v: string) {
    setError(null); setBusy(v)
    try {
      await patch({ tts_voice: v })
      const r = await api<{ audio_b64: string | null }>('/tts', { method: 'POST', body: JSON.stringify({ text: t.settings.sample }) })
      playB64(r.audio_b64)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(shop!.invite_code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      setError(null)
    }
  }

  const aspects: [Aspect, string, string][] = [
    ['ui_lang', L.ui, L.uiHelp], ['lang', L.speak, L.speakHelp], ['voice_lang', L.voice, L.voiceHelp], ['report_lang', L.report, L.reportHelp],
  ]
  const toggle = (k: Aspect | 'voice') => setOpen(open === k ? null : k)

  return (
    <Screen title={t.screens.settings}>
      <div className="flex flex-col gap-10">
        {error && <p className="t-body-lg" role="alert">{error}</p>}
        <section aria-labelledby="langs-title" className="flex flex-col gap-3" data-testid="languages">
          <h2 id="langs-title" className="t-label-lg">{L.title}</h2>
          <p className="t-body">{L.help}</p>
          <div className="border-b border-ink">
            {aspects.map(([k, label, help]) => (
              <div key={k} data-testid={`lang-${k}`}>
                <Row status="confirmed" onClick={() => toggle(k)}
                  right={<span lang={current[k]} className="t-body-lg">{k === 'lang' && m.speech_auto ? L.auto : t.languages[current[k]]}</span>}>
                  <span className="t-label-lg">{label}</span>
                </Row>
                {open === k && (
                  <div role="radiogroup" aria-label={label} className="pb-4">
                    <p className="py-2 t-body">{help}</p>
                    {LANG_ORDER.map((l) => (
                      <Row key={l} status={current[k] === l ? 'selected' : 'unselected'} checked={current[k] === l}
                        onClick={() => run(`${k}:${l}`, { [k]: l })}
                        right={busy === `${k}:${l}` ? <span className="t-label">{t.ledger.working}</span> : undefined}>
                        <span lang={l} className="t-h3">{t.languages[l]}</span>
                      </Row>
                    ))}
                    {k === 'lang' && (
                      <button type="button" role="switch" aria-checked={!!m.speech_auto} data-testid="speech-auto"
                        onClick={() => run('auto', { speech_auto: !m.speech_auto })}
                        className="mt-2 flex min-h-12 w-full items-center gap-3 border-t border-ink pt-4 text-left">
                        <StatusSquare status={m.speech_auto ? 'selected' : 'unselected'} size={16} />
                        <span className="flex flex-col gap-1">
                          <span className="t-body-lg">{L.auto}</span>
                          <span className="t-body">{L.autoHelp}</span>
                        </span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
        <section className="border-b border-ink">
          <Row status="confirmed" onClick={() => toggle('voice')}
            right={<span className="t-body-lg capitalize">{voice}</span>}>
            <span className="t-label-lg">{t.settings.voice}</span>
          </Row>
          {open === 'voice' && (
            <div role="radiogroup" aria-label={t.settings.voice} className="pb-4">
              <p className="py-2 t-body">{t.settings.voiceHelp}</p>
              {voicesFor(voiceLang).map((v) => (
                <Row key={v} status={voice === v ? 'selected' : 'unselected'} checked={voice === v} onClick={() => pickVoice(v)}
                  right={busy === v ? <span className="t-label">{t.ledger.working}</span>
                    : v === DEFAULT_VOICE[voiceLang] ? <span className="t-label">{t.settings.defaultVoice}</span> : undefined}>
                  <span className="t-body-lg capitalize">{v}</span>
                </Row>
              ))}
            </div>
          )}
          <div className="border-t border-ink py-4">
            <p className="t-label-lg">{t.settings.invite}</p>
            <div className="mt-3 flex items-center justify-between gap-4">
              <p className="t-amount tracking-[0.1em]" data-testid="invite-code">{shop.invite_code}</p>
              <ChipButton onClick={copy} active={copied}>{copied ? t.settings.copied : t.settings.copy}</ChipButton>
            </div>
            <p className="mt-2 t-body">{t.settings.inviteHelp}</p>
          </div>
          <Row status="unselected" onClick={() => supabase.auth.signOut()}>
            <span className="t-label-lg">{t.settings.logOut}</span>
          </Row>
        </section>
        <MyName current={m.display_name ?? me.data?.user.name ?? ''} onSave={(display_name) => patch({ display_name })} />
        <Members />
      </div>
    </Screen>
  )
}

/** GOAL_2.0 P4.1: each member names themselves; everyone sees it on what they add or change. */
function MyName({ current, onSave }: { current: string; onSave: (name: string) => Promise<unknown> }) {
  const [name, setName] = useState(current)
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [error, setError] = useState<string | null>(null)
  const qc = useQueryClient()
  async function submit(ev: FormEvent) {
    ev.preventDefault()
    setState('saving'); setError(null)
    try {
      await onSave(name.trim())
      qc.invalidateQueries({ queryKey: ['members'] })
      setState('saved')
    } catch (e) {
      setError((e as Error).message); setState('idle')
    }
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-4 border-t border-ink pt-6" data-testid="my-name">
      <Field label={t.settings.name} required maxLength={60} value={name} error={error}
        onChange={(e) => { setName(e.target.value); setState('idle') }} hint={t.settings.nameHelp} />
      {state === 'saved' && <p className="t-body" role="status">{t.settings.nameSaved}</p>}
      <Button type="submit" variant="outline" disabled={state === 'saving' || !name.trim()}>{state === 'saving' ? t.ledger.working : t.settings.saveName}</Button>
    </form>
  )
}

/** GOAL_2.0 P4.6: who is in the shop. Permissions are identical for everyone (a locked decision). */
function Members() {
  const q = useMembers()
  if (!q.data) return null
  return (
    <section aria-labelledby="members-title" className="flex flex-col gap-3">
      <h2 id="members-title" className="t-label-lg">{t.settings.members}</h2>
      <div className="border-b border-ink" data-testid="members">
        {q.data.members.map((mm) => (
          <Row key={mm.user_id} status="confirmed" right={<span className="t-body">{t.settings.roles[mm.role]}</span>}>
            <span className="t-body-lg">{shown(mm.name)}</span>
            <span className="block t-label">{t.settings.joined(formatDay(mm.joined_at.slice(0, 10)))}</span>
          </Row>
        ))}
      </div>
      <p className="t-body">{t.settings.sameRights}</p>
    </section>
  )
}
