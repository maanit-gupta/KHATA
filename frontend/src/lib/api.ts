import { supabase } from './supabase'
import { t } from '../strings/en'
import { demoApi, isDemo } from './demo'

const API_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')

/** Mirrors the backend's {error: {code, message}}; `message` is safe to show as-is. */
export class ApiError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (isDemo()) {
    return demoApi<T>(path, init).catch((e: Error & { status?: number; code?: string }) => {
      throw new ApiError(e.status ?? 400, e.code ?? 'demo', e.message)
    })
  }
  const { data } = await supabase.auth.getSession()
  const headers = new Headers(init.headers)
  if (data.session) headers.set('Authorization', `Bearer ${data.session.access_token}`)
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json')

  let resp: Response
  try {
    resp = await fetch(`${API_URL}${path}`, { ...init, headers })
  } catch {
    throw new ApiError(0, 'offline', t.auth.errors.generic)
  }
  const body = await resp.json().catch(() => null)
  if (!resp.ok) {
    const err = body?.error
    throw new ApiError(resp.status, err?.code ?? 'http_error', err?.message ?? t.auth.errors.generic)
  }
  return body as T
}

export type Membership = { shop_id: string; role: 'owner' | 'staff'; lang: string; tts_voice: string | null; joined_at: string }
export type Shop = { id: string; name: string; default_lang: string; invite_code: string; created_at: string }
export type Me = { user: { id: string; email: string | null; name: string | null }; membership: Membership | null; shop: Shop | null }
