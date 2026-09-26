/**
 * An in-memory stand-in for the FastAPI backend and Supabase Auth, installed with Playwright
 * route interception. It follows the CLAUDE.md §6.5 contract closely enough for the UI: paise in
 * responses, rupees in requests, {error:{code,message}} errors, balances from confirmed entries.
 * Voice, question and OCR results are queued by each test (the real services are never called).
 */
import type { Page, Route } from '@playwright/test'

export const API = 'http://api.test'
export const SB = 'http://sb.test'

type Kind = 'customer' | 'supplier'
export type Entry = {
  id: string; shop_id: string; type: string; amount_paise: number; status: 'pending' | 'confirmed' | 'voided'
  party_id: string | null; party_name: string | null; party_kind: Kind | null; note: string | null
  occurred_on: string; auto_saved: boolean; review_reason: string | null; source: 'voice' | 'receipt' | 'manual'
  created_at: string; receipt_id: string | null; voice_note_id: string | null
}
type Party = { id: string; display_name: string; kind: Kind; needs_review: boolean }
type Receipt = {
  receipt_id: string; status: string; kind: string; settled: boolean | null; vendor_name: string | null
  bill_date: string | null; total_paise: number | null; retried_in_english: boolean; error: string | null
  ocr_text?: string | null; total_check?: 'ok' | 'check' | null
  stage?: string | null; file_type?: string; created_at?: string
}
type History = { action: string; at: string; by: 'you' | 'another_member'; changes: { field: string; old: unknown; new: unknown }[] }

const CUSTOMER = new Set(['credit_given', 'payment_received'])
const SUPPLIER = new Set(['purchase_credit', 'purchase_paid', 'payment_made'])
const SIGN: Record<string, number> = { credit_given: 1, payment_received: -1, purchase_credit: -1, payment_made: 1 }
const USER = { id: 'user-1', email: 'asha@example.com', user_metadata: { name: 'Asha' } }

export function today(offsetDays = 0) {
  const d = new Date(Date.now() + 5.5 * 3600_000 - offsetDays * 86_400_000)
  return d.toISOString().slice(0, 10)
}

export class MockApi {
  signedIn = true
  hasShop = true
  lang = 'hi-IN'
  voice: string | null = null
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
  calls: { method: string; path: string; body: unknown }[] = []
  /** Raw bytes of every uploaded audio/image part, in order (GOAL_2.0 P1.2a). */
  uploads: { path: string; bytes: Buffer; mime: string }[] = []
  insights: unknown = null
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
      receipt_id: null, voice_note_id: null, ...e, party_name: p?.display_name ?? null, party_kind: p?.kind ?? null,
    }
    this.entries.push(row)
    this.history[row.id] = [{ action: 'create', at: new Date().toISOString(), by: 'you',
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
    return { user: { id: USER.id, email: USER.email, name: 'Asha' },
      membership: this.hasShop ? { shop_id: this.shop.id, role: 'owner', lang: this.lang, tts_voice: this.voice, joined_at: '2026-09-01T00:00:00Z' } : null,
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
  async install(page: Page) {
    if (this.signedIn) {
      const session = { access_token: 'e2e-token', refresh_token: 'e2e-refresh', token_type: 'bearer', expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600, user: { ...USER, aud: 'authenticated', role: 'authenticated' } }
      await page.addInitScript((s) => { window.localStorage.setItem('sb-sb-auth-token', JSON.stringify(s)) }, session)
    }
    // Context-level, so pop-ups (the bill photo tab) are answered too.
    const ctx = page.context()
    await ctx.route(`${SB}/**`, (r) => this.auth(r))
    await ctx.route(`${API}/**`, (r) => this.handle(r))
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
    this.calls.push({ method, path: path + url.search, body })
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
      if (typeof body.lang === 'string') this.lang = body.lang
      if (typeof body.tts_voice === 'string') this.voice = body.tts_voice
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
        note: (body.note as string) ?? null, occurred_on: (body.occurred_on as string) ?? today() })
      return ok(this.out(e), 201)
    }
    if (seg[0] === 'entries' && seg.length >= 2) {
      const e = this.entries.find((x) => x.id === seg[1])
      if (!e) return this.err(route, 404, 'not_found', 'That entry does not exist.')
      if (seg.length === 2 && method === 'GET') return ok({ entry: this.out(e), history: this.history[e.id] ?? [] })
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
        if (body.party_name) {
          const kind: Kind = SUPPLIER.has(e.type) ? 'supplier' : 'customer'
          const before = this.out(e).party_name
          e.party_id = this.party(String(body.party_name), kind)
          changes.push({ field: 'party', old: before, new: body.party_name })
        }
        this.history[e.id].push({ action: 'edit', at: new Date().toISOString(), by: 'you', changes })
        return ok(this.out(e))
      }
      if (seg[2] === 'confirm') {
        if (e.status !== 'pending') return this.err(route, 409, 'not_pending', 'Only pending entries can be confirmed.')
        e.status = 'confirmed'
        this.history[e.id].push({ action: 'confirm', at: new Date().toISOString(), by: 'you', changes: [{ field: 'status', old: 'pending', new: 'confirmed' }] })
        return ok(this.out(e))
      }
      if (seg[2] === 'void') {
        if (e.status !== 'voided') this.history[e.id].push({ action: 'void', at: new Date().toISOString(), by: 'you', changes: [{ field: 'status', old: e.status, new: 'voided' }] })
        e.status = 'voided'
        return ok(this.out(e))
      }
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
          note: pid ? null : (body.vendor_name as string) ?? null, occurred_on: (body.bill_date as string) || today() })
        r.status = 'done'
        return ok({ decision: auto ? 'auto' : 'confirm', entry: this.out(e), suggestion: null })
      }
    }

    if (path === '/review') return ok(this.review())
    if (path === '/insights/weekly') return ok(this.insights ?? this.weekly())
    if (path === '/tts') return ok({ text: String(body.text), audio_b64: SILENT_MP3 })
    if (seg[0] === 'media') return ok({ url: `${API}/files/${seg[1]}/${seg[2]}` })
    if (seg[0] === 'files') return route.fulfill({ status: 200, contentType: seg[1] === 'voice' ? 'audio/mpeg' : 'image/png', body: '' })
    return this.err(route, 404, 'not_found', 'That page or item does not exist.')
  }

  nextReceipt: Partial<Receipt> | null = null
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
      top_debtors: debtors, narration: text, narration_en: text }
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
