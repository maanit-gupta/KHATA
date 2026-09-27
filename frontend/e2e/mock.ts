/**
 * An in-memory stand-in for the FastAPI backend and Supabase Auth, installed with Playwright
 * route interception. It follows the CLAUDE.md §6.5 contract closely enough for the UI: paise in
 * responses, rupees in requests, {error:{code,message}} errors, balances from confirmed entries.
 * Voice, question and OCR results are queued by each test (the real services are never called).
 */
import type { Page, Route, WebSocketRoute } from '@playwright/test'
import { emptyDashboard, reportData } from './dashboard.fixture'

export const API = 'http://api.test'
export const SB = 'http://sb.test'

type Kind = 'customer' | 'supplier'
export type Entry = {
  id: string; shop_id: string; type: string; amount_paise: number; status: 'pending' | 'confirmed' | 'voided'
  party_id: string | null; party_name: string | null; party_kind: Kind | null; note: string | null
  occurred_on: string; auto_saved: boolean; review_reason: string | null; source: 'voice' | 'receipt' | 'manual'
  created_at: string; receipt_id: string | null; voice_note_id: string | null; created_by?: string
  expense_category?: string | null
}
type Party = { id: string; display_name: string; kind: Kind; needs_review: boolean }
type Receipt = {
  receipt_id: string; status: string; kind: string; settled: boolean | null; vendor_name: string | null
  bill_date: string | null; total_paise: number | null; retried_in_english: boolean; error: string | null
  ocr_text?: string | null; total_check?: 'ok' | 'check' | null
  stage?: string | null; file_type?: string; created_at?: string
}
type History = { action: string; at: string; actor: string; seq?: number; changes: { field: string; old: unknown; new: unknown }[] }

const CUSTOMER = new Set(['credit_given', 'payment_received'])
const SUPPLIER = new Set(['purchase_credit', 'purchase_paid', 'payment_made'])
const SIGN: Record<string, number> = { credit_given: 1, payment_received: -1, purchase_credit: -1, payment_made: 1 }
const USER = { id: 'user-1', email: 'asha@example.com', user_metadata: { name: 'Asha' } }
export type MockUser = typeof USER
export const ASHA: MockUser = USER
export const PRIYA: MockUser = { id: 'user-2', email: 'priya@example.com', user_metadata: { name: 'Priya' } }

/**
 * A stand-in for Supabase Realtime (GOAL_2.0 P4.2), wired in with Playwright's WebSocket routing.
 * It speaks realtime-js's wire format ([join_ref, ref, topic, event, payload]): answers phx_join with
 * ids for each postgres_changes binding, and pushes a change only to bindings whose filter names the
 * row's shop (the routing the real server does). Share one hub between MockApi instances to put
 * several shops on the same "server".
 */
export class RealtimeHub {
  subs: { ws: WebSocketRoute; topic: string; user: string; pcs: { id: number; event: string; schema: string; table: string; filter?: string }[] }[] = []
  delivered: Record<string, number> = {}
  private next = 1

  attach(ws: WebSocketRoute, user: string) {
    ws.onMessage((raw) => {
      const [joinRef, ref, topic, event, payload] = JSON.parse(String(raw))
      const reply = (response: unknown) => ws.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response }]))
      if (event === 'phx_join') {
        const pcs = (payload?.config?.postgres_changes ?? []).map((f: { event: string; schema: string; table: string; filter?: string }) => ({ ...f, id: this.next++ }))
        this.subs.push({ ws, topic, user, pcs })
        reply({ postgres_changes: pcs })
      } else {
        if (event === 'phx_leave') this.subs = this.subs.filter((x) => !(x.ws === ws && x.topic === topic))
        reply({})
      }
    })
    ws.onClose(() => { this.subs = this.subs.filter((x) => x.ws !== ws) })
  }

  publish(table: string, type: 'INSERT' | 'UPDATE', record: Record<string, unknown>) {
    const columns = Object.entries(record).map(([name, v]) => ({ name, type: typeof v === 'number' ? 'int8' : typeof v === 'boolean' ? 'bool' : 'text' }))
    for (const sub of this.subs) {
      for (const pc of sub.pcs) {
        if (pc.table !== table || (pc.event !== '*' && pc.event !== type)) continue
        if (pc.filter && pc.filter !== `shop_id=eq.${record.shop_id}`) continue
        this.delivered[sub.user] = (this.delivered[sub.user] ?? 0) + 1
        sub.ws.send(JSON.stringify([null, null, sub.topic, 'postgres_changes', { ids: [pc.id], data: {
          type, table, schema: 'public', record, old_record: {}, columns, commit_timestamp: new Date().toISOString(), errors: null } }]))
      }
    }
  }
}

export function today(offsetDays = 0) {
  const d = new Date(Date.now() + 5.5 * 3600_000 - offsetDays * 86_400_000)
  return d.toISOString().slice(0, 10)
}

export class MockApi {
  signedIn = true
  hasShop = true
  lang = 'hi-IN'
  voice: string | null = null
  /** GOAL_2.0 P5: per-aspect languages (null = same as lang). The on-screen text defaults to English
   * here so every other spec reads the English strings. */
  langs: { ui_lang: string | null; voice_lang: string | null; report_lang: string | null; speech_auto: boolean | null } =
    { ui_lang: 'en-IN', voice_lang: null, report_lang: null, speech_auto: null }
  shop = { id: 'shop-1', name: 'Sharma Kirana', default_lang: 'hi-IN', invite_code: 'K7Q2ZP', created_at: '2026-09-01T00:00:00Z' }
  parties: Party[] = []
  entries: Entry[] = []
  history: Record<string, History[]> = {}
  receipts: Record<string, Receipt & { reads: number; ready: Partial<Receipt> }> = {}
  voiceQueue: unknown[] = []
  resolveQueue: unknown[] = []
  askQueue: unknown[] = []
  offline = false
  delayMs: Record<string, number> = {}
  failNext: Record<string, { status: number; error: { code: string; message: string } }> = {}
  calls: { method: string; path: string; body: unknown; actor?: string }[] = []
  hub = new RealtimeHub()
  historySeq = 0
  /** The member making the current request (from the e2e token). */
  actor = USER.id
  users: MockUser[] = [USER, PRIYA]

  userById(id: string) { return this.users.find((u) => u.id === id) ?? USER }
  /** Raw bytes of every uploaded audio/image part, in order (GOAL_2.0 P1.2a). */
  uploads: { path: string; bytes: Buffer; mime: string }[] = []
  insights: unknown = null
  /** GET /dashboard: a hand-written fixture (e2e/dashboard.fixture.ts); the numbers are SQL's job,
   * tested in backend/tests/test_dashboard.py. */
  dashboard: unknown = null
  private seq = 0

  id(prefix: string) { return `${prefix}-${++this.seq}` }

  party(name: string, kind: Kind = 'customer', needs_review = false): string {
    const found = this.parties.find((p) => p.kind === kind && p.display_name.toLowerCase() === name.toLowerCase())
    if (found) return found.id
    const p = { id: this.id('p'), display_name: name, kind, needs_review }
    this.parties.push(p)
    return p.id
  }

  entry(e: Partial<Entry> & { type: string; amount_paise: number }): Entry {
    const p = this.parties.find((x) => x.id === e.party_id)
    const row: Entry = {
      id: this.id('e'), shop_id: this.shop.id, status: 'confirmed', party_id: null, note: null, occurred_on: today(),
      auto_saved: false, review_reason: null, source: 'manual', created_at: new Date(Date.now() + this.seq).toISOString(),
      receipt_id: null, voice_note_id: null, created_by: this.actor, ...e, party_name: p?.display_name ?? null, party_kind: p?.kind ?? null,
    }
    this.entries.push(row)
    this.hub.publish('entries', 'INSERT', this.record(row))
    this.history[row.id] = [{ action: 'create', at: new Date().toISOString(), seq: ++this.historySeq, actor: row.created_by ?? this.actor,
      changes: [{ field: 'amount_paise', old: null, new: row.amount_paise }, { field: 'type', old: null, new: row.type }] }]
    return row
  }

  /** A small shop: two customers, one supplier, a cash sale. */
  seed() {
    const ramesh = this.party('Ramesh')
    const lakshmi = this.party('Lakshmi')
    const gupta = this.party('Gupta Traders', 'supplier')
    this.entry({ type: 'credit_given', amount_paise: 230000, party_id: ramesh, occurred_on: today(9), source: 'voice', voice_note_id: 'vn-1' })
    this.entry({ type: 'payment_received', amount_paise: 50000, party_id: ramesh, occurred_on: today(3) })
    this.entry({ type: 'credit_given', amount_paise: 70000, party_id: lakshmi, occurred_on: today(1) })
    this.entry({ type: 'purchase_credit', amount_paise: 100000, party_id: gupta, occurred_on: today(2), source: 'receipt', receipt_id: 'r-seed' })
    this.entry({ type: 'cash_sale', amount_paise: 45050, occurred_on: today() })
    return this
  }

  balance(pid: string) {
    return this.entries.filter((e) => e.party_id === pid && e.status === 'confirmed').reduce((s, e) => s + (SIGN[e.type] ?? 0) * e.amount_paise, 0)
  }

  partyRow(p: Party) {
    const mine = this.entries.filter((e) => e.party_id === p.id && e.status === 'confirmed')
    return { party_id: p.id, shop_id: this.shop.id, display_name: p.display_name, kind: p.kind, needs_review: p.needs_review,
      balance_paise: this.balance(p.id), last_activity: mine.map((e) => e.occurred_on).sort().at(-1) ?? null }
  }

  out(e: Entry): Entry {
    const p = this.parties.find((x) => x.id === e.party_id)
    return { ...e, party_name: p?.display_name ?? null, party_kind: p?.kind ?? null }
  }

  me() {
    const u = this.userById(this.actor)
    return { user: { id: u.id, email: u.email, name: u.user_metadata.name },
      membership: this.hasShop ? { shop_id: this.shop.id, user_id: u.id, role: u.id === USER.id ? 'owner' : 'staff', lang: this.lang, tts_voice: this.voice, ...this.langs,
        joined_at: '2026-09-01T00:00:00Z', display_name: this.members.find((x) => x.user_id === u.id)?.display_name ?? u.user_metadata.name } : null,
      shop: this.hasShop ? this.shop : null }
  }

  review() {
    const rows: unknown[] = []
    for (const e of this.entries.filter((x) => x.status === 'pending')) rows.push({ item: 'entry', id: e.id, shop_id: this.shop.id, reason: e.review_reason, created_at: e.created_at, detail: this.out(e) })
    for (const p of this.parties.filter((x) => x.needs_review)) rows.push({ item: 'party', id: p.id, shop_id: this.shop.id, reason: 'new party created automatically', created_at: '2026-09-20T00:00:00Z', detail: this.partyRow(p) })
    for (const r of Object.values(this.receipts).filter((x) => x.status === 'failed')) rows.push({ item: 'receipt', id: r.receipt_id, shop_id: this.shop.id, reason: r.error ?? 'could not read total or date', created_at: '2026-09-20T00:00:00Z', detail: { ...r, id: r.receipt_id } })
    return { rows, count: rows.length }
  }

  // --- wiring -------------------------------------------------------------------------------
  async install(page: Page, as: MockUser = USER) {
    if (this.signedIn) {
      const session = { access_token: `e2e:${as.id}`, refresh_token: 'e2e-refresh', token_type: 'bearer', expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600, user: { ...as, aud: 'authenticated', role: 'authenticated' } }
      await page.addInitScript((s) => { window.localStorage.setItem('sb-sb-auth-token', JSON.stringify(s)) }, session)
    }
    // Context-level, so pop-ups (the bill photo tab) are answered too.
    const ctx = page.context()
    await ctx.route(`${SB}/**`, (r) => this.auth(r))
    await ctx.route(`${API}/**`, (r) => this.handle(r))
    await ctx.routeWebSocket(/sb\.test\/realtime/, (ws) => this.hub.attach(ws, as.id))
    // Fonts are decoration; don't let the network slow tests down.
    await ctx.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }))
  }

  private async auth(route: Route) {
    const url = new URL(route.request().url())
    const body = route.request().postDataJSON?.() ?? {}
    if (url.pathname.endsWith('/signup') || url.pathname.endsWith('/token')) {
      const user = { ...USER, email: body.email ?? USER.email, aud: 'authenticated', role: 'authenticated',
        user_metadata: body.data ?? USER.user_metadata }
      this.signedIn = true
      return route.fulfill({ json: { access_token: 'e2e-token', refresh_token: 'e2e-refresh', token_type: 'bearer',
        expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user } })
    }
    if (url.pathname.endsWith('/logout')) return route.fulfill({ status: 204, body: '' })
    if (url.pathname.endsWith('/user')) return route.fulfill({ json: USER })
    return route.fulfill({ json: {} })
  }

  private err(route: Route, status: number, code: string, message: string) {
    return route.fulfill({ status, json: { error: { code, message } } })
  }

  private async handle(route: Route) {
    const req = route.request()
    const url = new URL(req.url())
    const method = req.method()
    const path = url.pathname
    const seg = path.split('/').filter(Boolean)
    let body: Record<string, unknown> = {}
    const ct = req.headers()['content-type'] ?? ''
    if (req.postData() && ct.includes('application/json')) body = req.postDataJSON()
    if (ct.includes('multipart')) {
      // Text fields only (the audio/image part is binary): {answer_to, kind, settled, _file: mime}.
      const raw = req.postDataBuffer()?.toString('latin1') ?? ''
      for (const m of raw.matchAll(/name="(\w+)"\r\n\r\n([^\r]*)\r\n/g)) body[m[1]] = m[2]
      const file = /name="(?:audio|image)"; filename="([^"]+)"\r\nContent-Type: ([^\r]+)/.exec(raw)
      if (file) body._file = `${file[1]} ${file[2]}`
      const bytes = uploadedBytes(req.postDataBuffer(), ct)
      if (bytes) this.uploads.push({ path, bytes, mime: file?.[2] ?? '' })
    }
    this.actor = /e2e:(\S+)/.exec(req.headers()['authorization'] ?? '')?.[1] ?? USER.id
    this.calls.push({ method, path: path + url.search, body, actor: this.actor })
    if (this.offline) return route.abort('internetdisconnected')
    const fail = this.failNext[`${method} ${seg[0]}`]
    if (fail) {
      delete this.failNext[`${method} ${seg[0]}`]
      return route.fulfill({ status: fail.status, json: { error: fail.error } })
    }
    const wait = this.delayMs[`${method} ${seg[0]}`]
    if (wait) await new Promise((r) => setTimeout(r, wait))
    const ok = (json: unknown, status = 200) => route.fulfill({ status, json })

    if (path === '/health') return ok({ ok: true })
    if (path === '/me' && method === 'GET') return ok(this.me())
    if (path === '/me' && method === 'PATCH') {
      if (typeof body.display_name === 'string') { const mm = this.members.find((x) => x.user_id === this.actor); if (mm) mm.display_name = body.display_name }
      if (typeof body.lang === 'string') this.lang = body.lang
      if (typeof body.tts_voice === 'string') this.voice = body.tts_voice
      for (const k of ['ui_lang', 'voice_lang', 'report_lang', 'speech_auto'] as const) {
        if (k in body) (this.langs as Record<string, unknown>)[k] = body[k]
      }
      return ok(this.me().membership)
    }
    if (path === '/shops' && method === 'POST') {
      this.hasShop = true; this.lang = String(body.lang); this.shop = { ...this.shop, name: String(body.name), default_lang: this.lang }
      return ok({ shop: this.shop, membership: this.me().membership }, 201)
    }
    if (path === '/shops/join' && method === 'POST') {
      if (String(body.code).toUpperCase() !== this.shop.invite_code) return this.err(route, 404, 'bad_invite_code', "That invite code doesn't match any shop. Check it with the shop owner.")
      this.hasShop = true; this.lang = String(body.lang)
      return ok({ shop: this.shop, membership: this.me().membership })
    }
    if (!this.hasShop) return this.err(route, 409, 'no_shop', 'Create or join a shop first.')

    // entries
    if (path === '/entries' && method === 'GET') {
      const status = url.searchParams.get('status')
      const list = [...this.entries].filter((e) => !status || e.status === status).sort((a, b) => b.created_at.localeCompare(a.created_at))
      return ok({ entries: list.slice(0, Number(url.searchParams.get('limit') ?? 20)).map((e) => this.out(e)) })
    }
    if (path === '/entries' && method === 'POST') {
      const type = String(body.type)
      const kind: Kind | null = CUSTOMER.has(type) ? 'customer' : SUPPLIER.has(type) ? 'supplier' : null
      if (kind && type !== 'purchase_paid' && !body.party_id && !String(body.party_name ?? '').trim()) {
        return this.err(route, 422, 'party_required', `Enter the ${kind}'s name for this entry.`)
      }
      const pid = (body.party_id as string) ?? (kind && body.party_name ? this.party(String(body.party_name), kind) : null)
      const e = this.entry({ type, amount_paise: Math.round(Number(body.amount_rupees) * 100), party_id: pid,
        note: (body.note as string) ?? null, occurred_on: (body.occurred_on as string) ?? today(),
        expense_category: (body.expense_category as string) ?? null })
      return ok(this.out(e), 201)
    }
    if (seg[0] === 'entries' && seg.length >= 2) {
      const e = this.entries.find((x) => x.id === seg[1])
      if (!e) return this.err(route, 404, 'not_found', 'That entry does not exist.')
      if (seg.length === 2 && method === 'GET') {
        return ok({ entry: { ...this.out(e), added_by: this.memberName(e.created_by) }, history: (this.history[e.id] ?? []).map((h) => ({ ...h, by: this.memberName(h.actor), by_you: h.actor === this.actor })) })
      }
      if (seg.length === 2 && method === 'PATCH') {
        if (e.status === 'voided') return this.err(route, 409, 'voided', "Voided entries can't be changed.")
        const changes: History['changes'] = []
        const set = (field: keyof Entry, v: unknown, label = field as string) => {
          if (e[field] !== v) { changes.push({ field: label, old: e[field], new: v }); (e as Record<string, unknown>)[field] = v }
        }
        if (body.type) set('type', body.type)
        if (body.amount_rupees !== undefined) set('amount_paise', Math.round(Number(body.amount_rupees) * 100))
        if (body.occurred_on) set('occurred_on', body.occurred_on)
        if (body.note !== undefined) set('note', (body.note as string) || null)
        if (body.expense_category !== undefined) set('expense_category', body.expense_category ?? null)
        if (body.party_name) {
          const kind: Kind = SUPPLIER.has(e.type) ? 'supplier' : 'customer'
          const before = this.out(e).party_name
          e.party_id = this.party(String(body.party_name), kind)
          changes.push({ field: 'party', old: before, new: body.party_name })
        }
        this.history[e.id].push({ action: 'edit', at: new Date().toISOString(), seq: ++this.historySeq, actor: this.actor, changes })
        this.hub.publish('entries', 'UPDATE', this.record(e))
        return ok(this.out(e))
      }
      if (seg[2] === 'confirm') {
        if (e.status !== 'pending') return this.err(route, 409, 'not_pending', 'Only pending entries can be confirmed.')
        e.status = 'confirmed'
        this.hub.publish('entries', 'UPDATE', this.record(e))
        this.history[e.id].push({ action: 'confirm', at: new Date().toISOString(), seq: ++this.historySeq, actor: this.actor, changes: [{ field: 'status', old: 'pending', new: 'confirmed' }] })
        return ok(this.out(e))
      }
      if (seg[2] === 'void') {
        if (e.status !== 'voided') this.history[e.id].push({ action: 'void', at: new Date().toISOString(), seq: ++this.historySeq, actor: this.actor, changes: [{ field: 'status', old: e.status, new: 'voided' }] })
        e.status = 'voided'
        this.hub.publish('entries', 'UPDATE', this.record(e))
        return ok(this.out(e))
      }
    }

    // ledger table (GOAL_2.0 P3)
    if (path === '/ledger' || path === '/ledger/export.csv') {
      const rows = this.ledgerRows(url.searchParams)
      if (path === '/ledger/export.csv') {
        const csv = ['Date,Party,Type,Amount (₹),Source,Added by,Status,Note,Recorded at (IST)',
          ...rows.map((e) => [e.occurred_on, e.party_name ?? '', e.type, (e.amount_paise / 100).toFixed(2), e.source,
            this.memberName(e.created_by), e.status, e.note ?? '', e.created_at.slice(0, 16).replace('T', ' ')].join(','))].join('\n')
        return route.fulfill({ status: 200, contentType: 'text/csv; charset=utf-8', body: '\ufeff' + csv,
          headers: { 'Content-Disposition': 'attachment; filename="khata-ledger-test.csv"', 'Access-Control-Expose-Headers': 'Content-Disposition' } })
      }
      const size = 50
      const page = Math.max(1, Number(url.searchParams.get('page') ?? 1))
      const conf = rows.filter((e) => e.status === 'confirmed')
      const sum = (t: string) => conf.filter((e) => e.type === t).reduce((a, e) => a + e.amount_paise, 0)
      return ok({ rows: rows.slice((page - 1) * size, page * size).map((e) => ({ ...e, added_by: this.memberName(e.created_by), confirmed_by_name: null })),
        page, page_size: size, total_count: rows.length, pages: Math.max(1, Math.ceil(rows.length / size)),
        totals: { cash_in_paise: sum('cash_sale'), credit_given_paise: sum('credit_given'), collected_paise: sum('payment_received'), expenses_paise: sum('expense') },
        members: this.members.map((mm) => ({ user_id: mm.user_id, name: this.memberName(mm.user_id) })) })
    }
    if (path === '/parties/suggest') {
      const q = (url.searchParams.get('q') ?? '').toLowerCase()
      const kind = url.searchParams.get('kind')
      const hits = this.parties.filter((pp) => (!kind || pp.kind === kind) && q && pp.display_name.toLowerCase().includes(q))
      return ok({ parties: hits.slice(0, 6).map((pp) => ({ party_id: pp.id, display_name: pp.display_name, kind: pp.kind })) })
    }
    if (seg[0] === 'parties' && seg[2] === 'statement') {
      const pp = this.parties.find((x) => x.id === seg[1])
      if (!pp) return this.err(route, 404, 'not_found', 'That party does not exist.')
      const from = url.searchParams.get('from'); const to = url.searchParams.get('to')
      let run = 0
      const all = this.entries.filter((e) => e.party_id === pp.id && e.status === 'confirmed')
        .sort((a, b) => a.occurred_on.localeCompare(b.occurred_on) || a.created_at.localeCompare(b.created_at))
        .map((e) => { const d = (SIGN[e.type] ?? 0) * e.amount_paise; run += d
          return { entry_id: e.id, occurred_on: e.occurred_on, type: e.type, amount_paise: e.amount_paise, note: e.note, source: e.source, delta_paise: d, running_balance_paise: run } })
      const before = all.filter((r) => from && r.occurred_on < from)
      const rows = all.filter((r) => (!from || r.occurred_on >= from) && (!to || r.occurred_on <= to))
      const opening = before.length ? before[before.length - 1].running_balance_paise : 0
      return ok({ party: this.partyRow(pp), from, to, opening_balance_paise: opening,
        closing_balance_paise: rows.length ? rows[rows.length - 1].running_balance_paise : opening, rows })
    }

    // parties
    if (path === '/parties' && method === 'GET') {
      return ok({ parties: this.parties.map((p) => this.partyRow(p)).sort((a, b) => a.display_name.localeCompare(b.display_name)) })
    }
    if (seg[0] === 'parties' && seg.length >= 2) {
      const p = this.parties.find((x) => x.id === seg[1])
      if (!p) return this.err(route, 404, 'not_found', 'That party does not exist.')
      if (seg.length === 2 && method === 'GET') {
        const list = this.entries.filter((e) => e.party_id === p.id && e.status !== 'voided').sort((a, b) => b.occurred_on.localeCompare(a.occurred_on))
        const row = this.partyRow(p)
        return ok({ party: row, balance_paise: row.balance_paise, entries: list.map((e) => this.out(e)) })
      }
      if (seg.length === 2 && method === 'PATCH') {
        if (typeof body.display_name === 'string') p.display_name = body.display_name
        if (typeof body.needs_review === 'boolean') p.needs_review = body.needs_review
        return ok(this.partyRow(p))
      }
      if (seg[2] === 'merge') {
        const into = this.parties.find((x) => x.id === body.into_party_id)
        if (!into) return this.err(route, 404, 'not_found', 'That party does not exist.')
        this.entries.filter((e) => e.party_id === p.id).forEach((e) => { e.party_id = into.id })
        this.parties = this.parties.filter((x) => x.id !== p.id)
        return ok(this.partyRow(into))
      }
    }

    // voice
    if (path === '/voice/entry') return this.fromQueue(route, this.voiceQueue, 'voice entry')
    if (path === '/voice/entry/resolve') return this.fromQueue(route, this.resolveQueue, 'resolve')
    if (path === '/voice/ask') return this.fromQueue(route, this.askQueue, 'question')

    // receipts
    if (path === '/receipts' && method === 'POST') {
      const id = this.id('r')
      const nextReady = this.nextReceipt ?? { status: 'done', vendor_name: 'Shree Balaji Traders', bill_date: today(2), total_paise: 188000,
        ocr_text: 'SHREE BALAJI TRADERS\nNet amount 1,880.00', total_check: 'ok' }
      const form = req.postData() ?? ''
      const kind = /name="kind"\r\n\r\n(\w+)/.exec(form)?.[1] ?? 'supplier'
      const settledRaw = /name="settled"\r\n\r\n(\w+)/.exec(form)?.[1]
      const fileType = /Content-Type: application\/pdf/.test(form) ? 'pdf' : 'image'
      this.receipts[id] = { receipt_id: id, status: 'queued', kind, settled: settledRaw === undefined ? null : settledRaw === 'true',
        vendor_name: null, bill_date: null, total_paise: null, retried_in_english: false, error: null, reads: 0, ready: nextReady,
        file_type: fileType, stage: 'uploaded', created_at: new Date().toISOString() }
      return ok({ receipt_id: id, status: 'queued' }, 201)
    }
    if (seg[0] === 'receipts' && seg.length >= 2) {
      const r = this.receipts[seg[1]]
      if (!r) return this.err(route, 404, 'not_found', 'That receipt does not exist.')
      if (seg.length === 2) {
        // Truthful stages, as the API reports them: reading, then checking, then the result.
        r.reads += 1
        const busy = r.status === 'queued' || r.status === 'processing'
        if (busy && !this.receiptStall && r.reads >= 3) Object.assign(r, { stage: null }, r.ready)
        else if (busy) Object.assign(r, { status: 'processing', stage: r.reads >= 2 && !this.receiptStall ? 'checking' : 'reading' })
        const { reads: _reads, ready: _ready, ...pub } = r
        return ok(pub)
      }
      if (seg[2] === 'save') {
        if (typeof body.kind === 'string') { r.kind = body.kind; r.settled = body.kind === 'expense' ? null : (body.settled as boolean) }
        const type = r.kind === 'supplier' ? (r.settled ? 'purchase_paid' : 'purchase_credit') : r.kind === 'customer' ? (r.settled ? 'cash_sale' : 'credit_given') : 'expense'
        const name = r.kind === 'supplier' ? String(body.vendor_name ?? '') : type === 'credit_given' ? String(body.customer_name ?? '') : ''
        if ((r.kind === 'supplier' || type === 'credit_given') && !name.trim()) return this.err(route, 422, 'party_required', type === 'credit_given' ? "Enter the customer's name." : "Enter the supplier's name.")
        const amount = Math.round(Number(body.total_rupees) * 100)
        const pid = name ? this.party(name, r.kind === 'supplier' ? 'supplier' : 'customer', true) : null
        const auto = amount <= 500000
        const e = this.entry({ type, amount_paise: amount, party_id: pid, source: 'receipt', receipt_id: r.receipt_id,
          status: auto ? 'confirmed' : 'pending', auto_saved: auto, review_reason: auto ? null : 'amount above ₹5,000',
          note: pid ? null : (body.vendor_name as string) ?? null, occurred_on: (body.bill_date as string) || today(),
          expense_category: type === 'expense' ? (body.expense_category as string) ?? null : null })
        r.status = 'done'
        return ok({ decision: auto ? 'auto' : 'confirm', entry: this.out(e), suggestion: null })
      }
    }

    if (path === '/dashboard') return ok(this.dashboard ?? emptyDashboard())
    if (path === '/reports/summary' || path === '/reports/summary/refresh') {
      const period = String((method === 'POST' ? body.period : url.searchParams.get('period')) ?? 'day')
      if (method === 'POST' && ++this.refreshes > 1) return this.err(route, 429, 'refresh_too_soon', 'This summary was just written. You can refresh it again in 5 min.')
      return ok(this.summary(period))
    }
    if (path === '/reports/data') {
      const ids = { kavya: this.party('Kavya'), arjun: this.party('Arjun'), meena: this.party('Meena'),
        lotus: this.party('Lotus Agencies', 'supplier'), balaji: this.party('Balaji Stores', 'supplier') }
      return ok(reportData(String(url.searchParams.get('from')), String(url.searchParams.get('to')), ids))
    }
    if (path === '/briefing') {
      const lang = this.outLang('report')
      return ok({ day: today(), lang, text: this.tag(this.briefingText, 'report'), text_en: this.briefingText, voice: 'shubh', audio_cached: this.briefingAudio > 0 })
    }
    if (path === '/briefing/audio') {
      this.briefingAudio++
      return ok({ url: `data:audio/mpeg;base64,${SILENT_MP3}`, voice: 'shubh', cached: this.briefingAudio > 1 })
    }
    if (path === '/members') {
      return ok({ members: this.members.map((mm) => ({ ...mm, name: this.memberName(mm.user_id), you: mm.user_id === this.actor })), invite_code: this.shop.invite_code })
    }
    if (path === '/activity') {
      const rows = Object.entries(this.history).flatMap(([entryId, hs]) => hs.map((h, i) => ({ h, i, e: this.entries.find((x) => x.id === entryId)! })))
        .sort((a, b) => (b.h.seq ?? 0) - (a.h.seq ?? 0) || b.h.at.localeCompare(a.h.at) || b.i - a.i).slice(0, 30)
      return ok({ activity: rows.map(({ h, e }, n) => ({ id: n + 1, at: h.at, action: h.action, entry_id: e.id, by: this.memberName(h.actor), by_you: h.actor === this.actor,
        type: e.type, amount_paise: e.amount_paise, party_name: this.out(e).party_name, note: e.note, changed: h.action === 'edit' ? h.changes.map((c) => c.field) : [] })) })
    }
    if (path === '/review') return ok(this.review())
    if (path === '/insights/weekly') return ok(this.insights ?? this.weekly())
    if (path === '/tts') {
      this.ttsLangs.push(this.outLang(body.purpose === 'report' ? 'report' : 'voice'))
      return ok({ text: this.tag(String(body.text), body.purpose === 'report' ? 'report' : 'voice'), audio_b64: SILENT_MP3 })
    }
    if (seg[0] === 'media') return ok({ url: `${API}/files/${seg[1]}/${seg[2]}` })
    if (seg[0] === 'files') return route.fulfill({ status: 200, contentType: seg[1] === 'voice' ? 'audio/mpeg' : 'image/png', body: '' })
    return this.err(route, 404, 'not_found', 'That page or item does not exist.')
  }

  nextReceipt: Partial<Receipt> | null = null
  members = [{ user_id: USER.id, display_name: 'Asha', role: 'owner', joined_at: '2026-09-01T00:00:00Z' }]

  memberName(id: string | undefined | null) {
    const mm = this.members.find((x) => x.user_id === id)
    if (!mm) return 'Member'
    return id === this.actor ? `${mm.display_name} (you)` : mm.display_name
  }

  /** The entries row as the database holds it (what Realtime sends). */
  record(e: Entry) {
    const { party_name: _n, party_kind: _k, ...row } = e
    return row as unknown as Record<string, unknown>
  }

  /** GET /ledger filtering, as the SQL does it: voided only when asked, newest first. */
  ledgerRows(q: URLSearchParams) {
    const list = (k: string) => (q.get(k) ?? '').split(',').filter(Boolean)
    const types = list('type'); const sources = list('source'); const statuses = list('status')
    const text = (q.get('q') ?? '').toLowerCase()
    return this.entries.map((e) => this.out(e)).filter((e) =>
      (!q.get('from') || e.occurred_on >= q.get('from')!) && (!q.get('to') || e.occurred_on <= q.get('to')!) &&
      (!types.length || types.includes(e.type)) && (!sources.length || sources.includes(e.source)) &&
      (!q.get('party') || e.party_id === q.get('party')) && (!q.get('member') || e.created_by === q.get('member')) &&
      (statuses.length ? statuses.includes(e.status) : e.status !== 'voided') &&
      (!text || (e.note ?? '').toLowerCase().includes(text) || (e.party_name ?? '').toLowerCase().includes(text)))
      .sort((a, b) => b.occurred_on.localeCompare(a.occurred_on) || b.created_at.localeCompare(a.created_at))
  }
  /** Keep every bill 'reading' forever (cancel / 90 s timeout paths). */
  receiptStall = false

  /** A plain default for GET /insights/weekly, computed from the mock's confirmed entries. */
  weekly() {
    const sum = (from: number, to: number) => {
      const rows = this.entries.filter((e) => e.status === 'confirmed' && e.occurred_on >= today(to) && e.occurred_on <= today(from))
      const total = (t: string) => rows.filter((e) => e.type === t).reduce((a, e) => a + e.amount_paise, 0)
      return { cash_sales_paise: total('cash_sale'), credit_given_paise: total('credit_given'), collected_paise: total('payment_received'),
        expenses_paise: total('expense'), purchases_paise: total('purchase_credit') + total('purchase_paid'),
        supplier_paid_paise: total('payment_made'), entry_count: rows.length }
    }
    const debtors = this.parties.map((p) => this.partyRow(p)).filter((p) => p.balance_paise > 0)
      .sort((a, b) => b.balance_paise - a.balance_paise).slice(0, 3)
      .map((p) => ({ party_id: p.party_id, name: p.display_name, balance_paise: p.balance_paise, days_since_last_activity: 1 }))
    const text = 'So far this week, the shop is on track.'
    return { week_start: today(6), week_end: today(0), today: today(0), this_week: sum(0, 6), last_week: sum(7, 13),
      top_debtors: debtors, narration: this.tag(text, 'report'), narration_en: text }
  }

  /** The backend's langs.py, mirrored: read-backs follow voice_lang, summaries report_lang, both
   * falling back to the language spoken in (GOAL_2.0 P5.3). */
  outLang(kind: 'voice' | 'report') {
    return (kind === 'report' ? this.langs.report_lang : this.langs.voice_lang) ?? this.lang
  }

  /** Stands in for translation: "[ta-IN] text" (the backend test fakes do the same). */
  tag(text: string, kind: 'voice' | 'report') {
    const lang = this.outLang(kind)
    return lang === 'en-IN' ? text : `[${lang}] ${text}`
  }

  /** The language of every POST /tts, in order. */
  ttsLangs: string[] = []

  /** GOAL_2.0 P7 (the backend number-guards and caches these; here they are fixtures). */
  tips: { rule: string; text: string }[] = []
  refreshes = 0
  briefingText = 'Yesterday: 300 rupees in cash sales, 0 rupees given on credit, 150 rupees collected and 0 rupees spent. Nothing is waiting in Review.'
  briefingAudio = 0
  summary(period: string) {
    const from = period === 'day' ? today(0) : period === 'month' ? `${today(0).slice(0, 8)}01` : today((new Date(`${today(0)}T00:00:00Z`).getUTCDay() + 6) % 7)
    const en = period === 'week' ? 'This week so far you sold 450 rupees in cash.' : 'Today so far you sold 300 rupees in cash.'
    return { period, period_start: from, from, to: today(0), lang: this.outLang('report'), summary: this.tag(en, 'report'),
      tips: this.tips.map((x) => this.tag(x.text, 'report')), summary_en: en, tips_en: this.tips.map((x) => x.text),
      tip_facts: this.tips.map((x) => ({ rule: x.rule })), cached: false, generated_at: new Date().toISOString() }
  }

  private fromQueue(route: Route, queue: unknown[], what: string) {
    const next = queue.shift()
    if (!next) return this.err(route, 500, 'server_error', `No mocked ${what} queued.`)
    if (typeof next === 'object' && next && 'error' in next && 'status' in next) {
      const e = next as { status: number; error: { code: string; message: string } }
      return route.fulfill({ status: e.status, json: { error: e.error } })
    }
    const value = typeof next === 'function' ? (next as () => unknown)() : next
    return route.fulfill({ json: value })
  }
}

/** A few bytes of silent MP3 so the ▶ controls have something to play. */
export const SILENT_MP3 = 'SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQxAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAAAAYYoRBqpAAAAAAD/+xDEAAPAAAGkAAAAIAAANIAAAARMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV'

export function voiceResult(m: MockApi, opts: { decision: 'auto' | 'confirm' | 'clarify'; type?: string; rupees?: number; party?: string; suggestion?: string | null; speech: string; reason?: string | null; transcript?: string }) {
  if (opts.decision === 'clarify') {
    return { decision: 'clarify', entry: null, suggestion: null, speech_text: opts.speech, audio_b64: SILENT_MP3, voice_note_id: m.id('vn'), transcript_en: opts.transcript ?? null, stt_raw: opts.transcript ?? null }
  }
  const kind: Kind = SUPPLIER.has(opts.type ?? '') ? 'supplier' : 'customer'
  const pid = opts.party ? m.party(opts.party, kind) : null
  const auto = opts.decision === 'auto'
  const e = m.entry({ type: opts.type ?? 'credit_given', amount_paise: Math.round((opts.rupees ?? 0) * 100), party_id: pid,
    status: auto ? 'confirmed' : 'pending', auto_saved: auto, source: 'voice', review_reason: opts.reason ?? null, voice_note_id: m.id('vn') })
  return { decision: opts.decision, entry: m.out(e), suggestion: opts.suggestion ?? null, speech_text: opts.speech, audio_b64: SILENT_MP3, voice_note_id: e.voice_note_id, transcript_en: opts.transcript ?? null, stt_raw: opts.transcript ?? null }
}

/** The file part of a multipart body, as raw bytes. */
function uploadedBytes(buf: Buffer | null, contentType: string): Buffer | null {
  const boundary = /boundary=([^;]+)/.exec(contentType)?.[1]
  if (!buf || !boundary) return null
  const head = buf.indexOf(Buffer.from('filename="'))
  if (head < 0) return null
  const start = buf.indexOf(Buffer.from('\r\n\r\n'), head) + 4
  const end = buf.indexOf(Buffer.from(`\r\n--${boundary}`), start)
  return end > start ? Buffer.from(buf.subarray(start, end)) : null
}
