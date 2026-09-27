import { supabase } from './supabase'
import { t } from '../strings'
import { setOffline } from './connectivity'

const API_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')

/** Mirrors the backend's {error: {code, message}}; `message` is safe to show as-is. */
export class ApiError extends Error {
  status: number
  code: string
  /** Extra fields next to code and message, e.g. {party_id, party_name} on name_taken. */
  details: Record<string, unknown>
  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

const REFRESH_WITHIN_S = 60
export const SESSION_ENDED_KEY = 'khata-session-ended'

/** The access token, renewed first when it expires within a minute (GOAL_2.0 P8). */
async function accessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  let s = data.session
  if (s?.expires_at && s.expires_at - Date.now() / 1000 < REFRESH_WITHIN_S) {
    const r = await supabase.auth.refreshSession()
    s = r.data.session ?? s
  }
  return s?.access_token ?? null
}

/** The server refused the login mid-action: sign out here, and remember why, so the login page says
 * so and then returns the user to the page they were on (the route guards carry the path). */
async function sessionEnded() {
  try { sessionStorage.setItem(SESSION_ENDED_KEY, '1') } catch { /* private mode */ }
  await supabase.auth.signOut({ scope: 'local' })
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await accessToken()
  const headers = new Headers(init.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
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
    const { code, message, ...details } = body?.error ?? {}
    if (resp.status === 401 && token) await sessionEnded()
    throw new ApiError(resp.status, code ?? 'http_error', message ?? t.auth.errors.generic, details)
  }
  return body as T
}

/** A file from the API (CSV export): the bytes and the server's filename. Same auth and errors. */
export async function apiBlob(path: string): Promise<{ blob: Blob; filename: string | null }> {
  const token = await accessToken()
  const headers = new Headers()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  let resp: Response
  try {
    resp = await fetch(`${API_URL}${path}`, { headers, cache: 'no-store' })
  } catch {
    setOffline(true)
    throw new ApiError(0, 'offline', t.offline.network)
  }
  if (!resp.ok) {
    const body = await resp.json().catch(() => null)
    if (resp.status === 401 && token) await sessionEnded()
    throw new ApiError(resp.status, body?.error?.code ?? 'http_error', body?.error?.message ?? t.auth.errors.generic)
  }
  const filename = /filename="([^"]+)"/.exec(resp.headers.get('Content-Disposition') ?? '')?.[1] ?? null
  return { blob: await resp.blob(), filename }
}

export type Membership = { shop_id: string; user_id?: string; role: 'owner' | 'staff'; lang: string; tts_voice: string | null; joined_at: string
  /** GOAL_2.0 P4.1 / P5 / P1.6: the member's name and per-aspect languages (null = same as lang). */
  display_name?: string | null; ui_lang?: string | null; voice_lang?: string | null; report_lang?: string | null; speech_auto?: boolean | null }
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
