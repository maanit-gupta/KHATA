import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useMe } from '../auth/session'
import { ChipButton } from '../components/ui/Chip'
import { Row } from '../components/ui/Row'
import { api, type Membership } from '../lib/api'
import { exitDemo, isDemo } from '../lib/demo'
import { playB64 } from '../lib/ledger'
import { supabase } from '../lib/supabase'
import { DEFAULT_VOICE, voicesFor } from '../lib/voices'
import { LANG_ORDER, t, type Lang } from '../strings/en'
import { Screen } from './AppShell'

/** DESIGN.md §6.12: My language, Voice (plays a sample), Shop invite code (COPY), LOG OUT. */
export function SettingsScreen() {
  const me = useMe()
  const qc = useQueryClient()
  const [open, setOpen] = useState<'lang' | 'voice' | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const m = me.data?.membership
  const shop = me.data?.shop
  if (!m || !shop) return <Screen title={t.screens.settings} />
  const lang = m.lang as Lang
  const voice = m.tts_voice ?? DEFAULT_VOICE[lang]

  async function patch(body: Partial<Pick<Membership, 'lang' | 'tts_voice'>>) {
    const next = await api<Membership>('/me', { method: 'PATCH', body: JSON.stringify(body) })
    qc.setQueryData(['me', me.data!.user.id], { ...me.data!, membership: next })
    qc.invalidateQueries({ queryKey: ['insights'] })
    return next
  }

  async function pickLang(l: Lang) {
    setError(null); setBusy(l)
    try { await patch({ lang: l }) } catch (e) { setError((e as Error).message) } finally { setBusy(null) }
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

  return (
    <Screen title={t.screens.settings}>
      <div className="flex flex-col gap-10">
        {error && <p className="t-body-lg" role="alert">{error}</p>}
        <section className="border-b border-ink">
          <Row status="confirmed" onClick={() => setOpen(open === 'lang' ? null : 'lang')}
            right={<span lang={lang} className="t-body-lg">{t.languages[lang]}</span>}>
            <span className="t-label-lg">{t.settings.language}</span>
          </Row>
          {open === 'lang' && (
            <div role="radiogroup" aria-label={t.settings.language} className="pb-4">
              <p className="py-2 t-body">{t.settings.languageHelp}</p>
              {LANG_ORDER.map((l) => (
                <Row key={l} status={lang === l ? 'selected' : 'unselected'} checked={lang === l} onClick={() => pickLang(l)}
                  right={busy === l ? <span className="t-label">{t.ledger.working}</span> : undefined}>
                  <span lang={l} className="t-h3">{t.languages[l]}</span>
                </Row>
              ))}
            </div>
          )}
          <Row status="confirmed" onClick={() => setOpen(open === 'voice' ? null : 'voice')}
            right={<span className="t-body-lg capitalize">{voice}</span>}>
            <span className="t-label-lg">{t.settings.voice}</span>
          </Row>
          {open === 'voice' && (
            <div role="radiogroup" aria-label={t.settings.voice} className="pb-4">
              <p className="py-2 t-body">{t.settings.voiceHelp}</p>
              {voicesFor(lang).map((v) => (
                <Row key={v} status={voice === v ? 'selected' : 'unselected'} checked={voice === v} onClick={() => pickVoice(v)}
                  right={busy === v ? <span className="t-label">{t.ledger.working}</span>
                    : v === DEFAULT_VOICE[lang] ? <span className="t-label">{t.settings.defaultVoice}</span> : undefined}>
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
          <Row status="unselected" onClick={() => (isDemo() ? exitDemo() : supabase.auth.signOut())}>
            <span className="t-label-lg">{t.settings.logOut}</span>
          </Row>
        </section>
      </div>
    </Screen>
  )
}
