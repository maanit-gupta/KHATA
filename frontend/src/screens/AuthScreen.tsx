import type { AuthError } from '@supabase/supabase-js'
import { useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { SplitLayout } from '../components/SplitLayout'
import { Button } from '../components/ui/Button'
import { Field } from '../components/ui/Field'
import { supabase } from '../lib/supabase'
import { t } from '../strings'

type Mode = 'login' | 'signup'
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

/** DESIGN.md §6.1. After success the route guard sends the user to /app or /onboarding. */
export function AuthScreen({ mode }: { mode: Mode }) {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const [busy, setBusy] = useState(false)
  const signup = mode === 'signup'

  function validate(): Errors {
    const e: Errors = {}
    if (signup && !name.trim()) e.name = t.auth.errors.required
    if (!email.trim()) e.email = t.auth.errors.required
    else if (!EMAIL_RE.test(email.trim())) e.email = t.auth.errors.email
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
    const { error } = signup
      ? await supabase.auth.signUp({ email: email.trim(), password, options: { data: { name: name.trim() } } })
      : await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    if (error) {
      setErrors({ form: friendly(error) })
      return
    }
    await qc.invalidateQueries({ queryKey: ['me'] })
  }

  return (
    <SplitLayout heading={t.auth.heading} blurb={t.auth.blurb} label={t.auth.sideLabel}>
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-8">
        {signup && (
          <Field dark label={t.auth.name} required autoComplete="name" value={name}
            onChange={(e) => setName(e.target.value)} error={errors.name} />
        )}
        <Field dark label={t.auth.email} required type="email" autoComplete="email" inputMode="email"
          value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} />
        <Field dark label={t.auth.password} required type="password"
          autoComplete={signup ? 'new-password' : 'current-password'}
          value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} />
        {errors.form && <p className="t-body" role="alert">{errors.form}</p>}
        <Button type="submit" variant="inverse" disabled={busy}>
          {busy ? t.auth.working : signup ? t.auth.createAccount : t.auth.logIn}
        </Button>
        <Link to={signup ? '/login' : '/signup'} className="inline-flex min-h-12 items-center self-start t-label underline decoration-1 underline-offset-4">
          {signup ? t.auth.toLogin : t.auth.toSignup}
        </Link>
        <Link to="/about" className="inline-flex min-h-12 items-center self-start t-label underline decoration-1 underline-offset-4">
          {t.about.link}
        </Link>
      </form>
    </SplitLayout>
  )
}
