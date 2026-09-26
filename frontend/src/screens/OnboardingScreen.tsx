import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { SplitLayout } from '../components/SplitLayout'
import { Button } from '../components/ui/Button'
import { SegmentChip } from '../components/ui/Chip'
import { Field } from '../components/ui/Field'
import { Row } from '../components/ui/Row'
import { useReveal } from '../hooks/useReveal'
import { api, ApiError, type Membership, type Shop } from '../lib/api'
import { LANG_ORDER, t, type Lang } from '../strings/en'

type Mode = 'create' | 'join'

/**
 * CLAUDE.md §3 / DESIGN.md §6.2. Step 1 collects the shop name or invite code (no API call).
 * Step 2 picks the language (en-IN pre-selected for joiners), then POST /shops or /shops/join.
 */
export function OnboardingScreen() {
  const qc = useQueryClient()
  const [step, setStep] = useState<1 | 2>(1)
  const [mode, setMode] = useState<Mode>('create')
  const [shopName, setShopName] = useState('')
  const [code, setCode] = useState('')
  const [lang, setLang] = useState<Lang | null>(null)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [langError, setLangError] = useState<string | null>(null)
  const reveal = useReveal({ key: 'onboarding-languages' })

  const submit = useMutation({
    mutationFn: (chosen: Lang) =>
      mode === 'create'
        ? api<{ shop: Shop; membership: Membership }>('/shops', { method: 'POST', body: JSON.stringify({ name: shopName.trim(), lang: chosen }) })
        : api<{ shop: Shop; membership: Membership }>('/shops/join', { method: 'POST', body: JSON.stringify({ code: code.trim(), lang: chosen }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'bad_invite_code') {
        setFieldError(err.message)
        setStep(1)
      }
    },
  })

  function chooseMode(m: Mode) {
    setMode(m)
    setFieldError(null)
  }

  function next(ev: FormEvent) {
    ev.preventDefault()
    if (mode === 'create' && !shopName.trim()) return setFieldError(t.onboarding.errors.required)
    if (mode === 'join' && !code.trim()) return setFieldError(t.onboarding.errors.required)
    if (mode === 'join' && code.trim().length !== 6) return setFieldError(t.onboarding.errors.codeLength)
    setFieldError(null)
    if (lang === null && mode === 'join') setLang('en-IN')
    setStep(2)
  }

  function confirm() {
    if (!lang) return setLangError(t.onboarding.errors.pickLanguage)
    setLangError(null)
    submit.mutate(lang)
  }

  const formError = submit.error && !(submit.error instanceof ApiError && submit.error.code === 'bad_invite_code')
    ? submit.error.message : null

  return (
    <SplitLayout
      heading={step === 1 ? t.onboarding.heading : t.onboarding.languageHeading}
      label={t.onboarding.step(step)}
    >
      {step === 1 ? (
        <form noValidate onSubmit={next} className="flex flex-col gap-8">
          <div className="grid grid-cols-2 gap-2" role="group">
            <SegmentChip dark selected={mode === 'create'} onClick={() => chooseMode('create')}>{t.onboarding.create}</SegmentChip>
            <SegmentChip dark selected={mode === 'join'} onClick={() => chooseMode('join')}>{t.onboarding.join}</SegmentChip>
          </div>
          {mode === 'create' ? (
            <Field key="name" dark required label={t.onboarding.shopName} value={shopName} autoComplete="organization"
              onChange={(e) => setShopName(e.target.value)} error={fieldError} />
          ) : (
            <Field key="code" dark required label={t.onboarding.code} value={code} maxLength={6}
              autoCapitalize="characters" autoComplete="off" spellCheck={false}
              className="[&_input]:uppercase [&_input]:tracking-[0.2em]"
              onChange={(e) => setCode(e.target.value.replace(/\s/g, ''))} error={fieldError} />
          )}
          <Button type="submit" variant="inverse">{t.onboarding.next}</Button>
        </form>
      ) : (
        <div className="flex flex-col gap-8">
          <p className="t-body">{t.onboarding.languageHelp}</p>
          <div role="radiogroup" aria-label={t.onboarding.languageHeading.join(' ')} className="border-b border-[var(--hairline-dark)]">
            {LANG_ORDER.map((l, i) => (
              <Row key={l} dark status={lang === l ? 'selected' : 'unselected'} checked={lang === l}
                onClick={() => setLang(l)} index={i} animate={reveal.animate}>
                <span lang={l} className="t-h3">{t.languages[l]}</span>
              </Row>
            ))}
          </div>
          {(langError || formError) && <p className="t-body" role="alert">{langError ?? formError}</p>}
          <Button variant="inverse" onClick={confirm} disabled={submit.isPending}>
            {submit.isPending ? t.auth.working : mode === 'create' ? t.onboarding.createShop : t.onboarding.joinShop}
          </Button>
          <Button variant="text" className="self-start" onClick={() => setStep(1)}>{t.onboarding.back}</Button>
        </div>
      )}
    </SplitLayout>
  )
}
