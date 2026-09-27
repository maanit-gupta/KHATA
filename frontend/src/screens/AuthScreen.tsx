import type { AuthError } from '@supabase/supabase-js'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { SplitLayout } from '../components/SplitLayout'
import { Button } from '../components/ui/Button'
import { Field } from '../components/ui/Field'
import { SESSION_ENDED_KEY } from '../lib/api'
import { supabase } from '../lib/supabase'
import { t } from '../strings'

type Mode = 'login' | 'signup' | 'forgot'
type Errors = Partial<Record<'name' | 'email' | 'password' | 'form', string>>

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MIN_PASSWORD = 6 // Supabase Auth's default minimum

function friendly(error: AuthError): string {
  switch (error.code) {
    case 'invalid_credentials':
      return t.auth.errors.badLogin
    case 'user_already_exists':
    case 'email_exists':
      return t.auth.errors.exists
    case 'email_provider_disabled':
      return t.auth.errors.emailDisabled
    case 'weak_password':
      return t.auth.errors.passwordShort
    case 'email_address_invalid':
      return t.auth.errors.email
    default:
      // Network failures have no HTTP status (or a 5xx); anything else carries Supabase's own
      // plain-English message, which is more useful than a generic line.
      return !error.status || error.status >= 500 ? t.auth.errors.generic : error.message
  }
}

/** A password field with SHOW / HIDE on its underline (GOAL_2.0 P8). */
export function PasswordField({ label, value, onChange, error, autoComplete }:
  { label: string; value: string; onChange: (v: string) => void; error?: string; autoComplete: string }) {
  const [shown, setShown] = useState(false)
  return (
    <Field dark label={label} required type={shown ? 'text' : 'password'} autoComplete={autoComplete}
      autoCapitalize="none" autoCorrect="off" spellCheck={false}
      value={value} onChange={(e) => onChange(e.target.value)} error={error}
      action={(
        <button type="button" onClick={() => setShown((x) => !x)} aria-pressed={shown} aria-label={t.auth.showPassword}
          className="inline-flex min-h-12 min-w-12 shrink-0 items-center justify-center t-label underline underline-offset-4">
          {shown ? t.auth.hide : t.auth.show}
        </button>
      )} />
  )
}

function sessionEndedNotice(): boolean {
  try { return sessionStorage.getItem(SESSION_ENDED_KEY) === '1' } catch { return false }
}

/** DESIGN.md §6.1. After success the route guard sends the user to /app or /onboarding, or back to
 * the page their session ended on. */
export function AuthScreen({ mode }: { mode: Mode }) {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [ended] = useState(sessionEndedNotice)
  const signup = mode === 'signup'
  const forgot = mode === 'forgot'

  function validate(): Errors {
    const e: Errors = {}
    if (signup && !name.trim()) e.name = t.auth.errors.required
    if (!email.trim()) e.email = t.auth.errors.required
    else if (!EMAIL_RE.test(email.trim())) e.email = t.auth.errors.email
    if (forgot) return e
    if (!password) e.password = t.auth.errors.required
    else if (signup && password.length < MIN_PASSWORD) e.password = t.auth.errors.passwordShort
    return e
  }

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault()
    const e = validate()
    setErrors(e)
    if (Object.keys(e).length) return
    setBusy(true)
    if (forgot) {
      // Supabase answers the same whether or not the address has an account, and so do we.
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/reset` })
      setBusy(false)
      if (error && (!error.status || error.status >= 500)) setErrors({ form: t.auth.errors.generic })
      else if (error) setErrors({ form: error.message })
      else setSent(true)
      return
    }
    const { error } = signup
      ? await supabase.auth.signUp({ email: email.trim(), password, options: { data: { name: name.trim() } } })
      : await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    if (error) {
      setErrors({ form: friendly(error) })
      return
    }
    try { sessionStorage.removeItem(SESSION_ENDED_KEY) } catch { /* private mode */ }
    await qc.invalidateQueries({ queryKey: ['me'] })
  }

  if (forgot) {
    return (
      <SplitLayout heading={t.auth.heading} blurb={t.auth.blurb} label={t.auth.sideLabel}>
        <form noValidate onSubmit={onSubmit} className="flex flex-col gap-8" data-testid="forgot-form">
          <h1 className="t-h3">{t.auth.forgot}</h1>
          {sent ? <p className="t-body-lg" role="status">{t.auth.linkSent}</p> : (
            <>
              <p className="t-body">{t.auth.forgotHelp}</p>
              <Field dark label={t.auth.email} required type="email" autoComplete="email" inputMode="email"
                value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} />
              {errors.form && <p className="t-body" role="alert">{errors.form}</p>}
              <Button type="submit" variant="inverse" disabled={busy}>{busy ? t.auth.working : t.auth.sendLink}</Button>
            </>
          )}
          <Link to="/login" className="inline-flex min-h-12 items-center self-start t-label underline decoration-1 underline-offset-4">{t.auth.toLogin}</Link>
        </form>
      </SplitLayout>
    )
  }

  return (
    <SplitLayout heading={t.auth.heading} blurb={t.auth.blurb} label={t.auth.sideLabel}>
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-8">
        {ended && !signup && <p className="t-body-lg" role="status" data-testid="session-ended">{t.auth.sessionEnded}</p>}
        {signup && (
          <Field dark label={t.auth.name} required autoComplete="name" value={name}
            onChange={(e) => setName(e.target.value)} error={errors.name} />
        )}
        <Field dark label={t.auth.email} required type="email" autoComplete="email" inputMode="email"
          value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} />
        <PasswordField label={t.auth.password} autoComplete={signup ? 'new-password' : 'current-password'}
          value={password} onChange={setPassword} error={errors.password} />
        {errors.form && <p className="t-body" role="alert">{errors.form}</p>}
        <Button type="submit" variant="inverse" disabled={busy}>
          {busy ? t.auth.working : signup ? t.auth.createAccount : t.auth.logIn}
        </Button>
        <Link to={signup ? '/login' : '/signup'} className="inline-flex min-h-12 items-center self-start t-label underline decoration-1 underline-offset-4">
          {signup ? t.auth.toLogin : t.auth.toSignup}
        </Link>
        {!signup && (
          <Link to="/forgot" className="inline-flex min-h-12 items-center self-start t-label underline decoration-1 underline-offset-4">{t.auth.forgot}</Link>
        )}
        <Link to="/about" className="inline-flex min-h-12 items-center self-start t-label underline decoration-1 underline-offset-4">
          {t.about.link}
        </Link>
      </form>
    </SplitLayout>
  )
}

/**
 * /reset: the page the password-reset email links to (GOAL_2.0 P8). Supabase signs the user in from
 * the link (detectSessionInUrl); they set a new password and go on to the app.
 */
export function ResetScreen() {
  const navigate = useNavigate()
  const [ready, setReady] = useState<boolean | null>(null)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let done = false
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || session) { done = true; setReady(true) }
    })
    supabase.auth.getSession().then(({ data: d }) => { if (d.session) { done = true; setReady(true) } })
    const id = window.setTimeout(() => { if (!done) setReady(false) }, 4000)
    return () => { data.subscription.unsubscribe(); window.clearTimeout(id) }
  }, [])
  async function submit(ev: FormEvent) {
    ev.preventDefault()
    if (password.length < MIN_PASSWORD) { setError(t.auth.errors.passwordShort); return }
    setBusy(true)
    const { error: e } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (e) { setError(friendly(e)); return }
    navigate('/app', { replace: true })
  }
  return (
    <SplitLayout heading={t.auth.heading} blurb={t.auth.blurb} label={t.auth.sideLabel}>
      <form noValidate onSubmit={submit} className="flex flex-col gap-8" data-testid="reset-form">
        <h1 className="t-h3">{t.auth.newPassword}</h1>
        {ready === false ? (
          <>
            <p className="t-body-lg" role="alert">{t.auth.resetExpired}</p>
            <Link to="/forgot" className="inline-flex min-h-12 items-center self-start t-label underline decoration-1 underline-offset-4">{t.auth.askAgain}</Link>
          </>
        ) : (
          <>
            <PasswordField label={t.auth.newPassword} autoComplete="new-password" value={password} onChange={setPassword} error={error} />
            <Button type="submit" variant="inverse" disabled={busy || !ready}>{busy ? t.auth.working : t.auth.setPassword}</Button>
          </>
        )}
      </form>
    </SplitLayout>
  )
}
