import { supabase } from './supabase'
import { t } from '../strings/en'
import { setOffline } from './connectivity'

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
  const { data } = await supabase.auth.getSession()
  const headers = new Headers(init.headers)
  if (data.session) headers.set('Authorization', `Bearer ${data.session.access_token}`)
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json')

  let resp: Response
  try {
    // no-store: a voice or bill result must never come from the HTTP cache (GOAL_2.0 P1.2b).
    resp = await fetch(`${API_URL}${path}`, { ...init, headers, cache: 'no-store' })
  } catch {
    setOffline(true) // the request never reached the server: show the offline overlay
    throw new ApiError(0, 'offline', t.offline.network)
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

/** GET /health: true when the API answers. Used by the offline overlay's RETRY. */
export async function ping(): Promise<boolean> {
  try {
    const r = await fetch(`${API_URL}/health`, { cache: 'no-store' })
    return r.ok
  } catch {
    return false
  }
}
