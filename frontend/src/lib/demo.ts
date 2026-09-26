/**
 * Demo mode: the whole app runs against an in-memory copy of this fake backend, so the live site
 * can be tried without an account or a running API. Nothing leaves the browser; a reload resets
 * the data. Turned on by /demo or the "Try the demo" button, off by Log out.
 */
import type { Session } from '@supabase/supabase-js'
import type { Me } from './api'
import type { Entry, EntryType, Party } from './ledger'

const FLAG = 'khata-demo'
const AUTO_SAVE_CAP_PAISE = 500_000

export function isDemo(): boolean {
  try { return sessionStorage.getItem(FLAG) === '1' } catch { return false }
}

export function enterDemo(to = '/app') {
  try { sessionStorage.setItem(FLAG, '1') } catch { /* private mode: demo lasts this page only */ }
  window.location.assign(to)
}

export function exitDemo() {
  try { sessionStorage.removeItem(FLAG) } catch { /* ignore */ }
  window.location.assign('/login')
}

const USER_ID = 'demo-user'
export const DEMO_SESSION = { access_token: 'demo', user: { id: USER_ID, email: 'demo@khata.app' } } as unknown as Session

const ME: Me = {
  user: { id: USER_ID, email: 'demo@khata.app', name: 'Demo shopkeeper' },
  membership: { shop_id: 'demo-shop', role: 'owner', lang: 'hi-IN', tts_voice: null, joined_at: new Date().toISOString() },
  shop: { id: 'demo-shop', name: 'Sharma Kirana Store', default_lang: 'hi-IN', invite_code: 'DEMO42', created_at: new Date().toISOString() },
}

type P = { id: string; display_name: string; kind: 'customer' | 'supplier'; needs_review: boolean }
const parties: P[] = [
  ['Ramesh', 'customer'], ['Lakshmi', 'customer'], ['Suresh', 'customer'], ['Priya', 'customer'],
  ['Gupta Traders', 'supplier'], ['Balaji Dairy', 'supplier'],
].map(([n, k], i) => ({ id: `p${i}`, display_name: n, kind: k as P['kind'], needs_review: false }))

const byName = (n: string) => parties.find((p) => p.display_name === n)!.id
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10)
let seq = 0
const entries: Entry[] = ([
  ['Ramesh', 'credit_given', 450, 12], ['Ramesh', 'payment_received', 200, 6], ['Ramesh', 'credit_given', 300, 2],
  ['Lakshmi', 'credit_given', 1200, 20], ['Lakshmi', 'payment_received', 500, 9], ['Suresh', 'credit_given', 780, 4],
  ['Priya', 'credit_given', 150, 1], ['Gupta Traders', 'purchase_credit', 4200, 10, 'Rice and dal'],
  ['Gupta Traders', 'payment_made', 2000, 3], ['Balaji Dairy', 'purchase_credit', 1800, 5, 'Milk, curd'],
  [null, 'cash_sale', 2350, 1], [null, 'expense', 600, 3, 'Electricity'], [null, 'cash_sale', 1980, 0],
] as [string | null, EntryType, number, number, string?][]).map(([p, type, rs, ago, note]) =>
  makeEntry({ party_id: p ? byName(p) : null, type, amount_paise: rs * 100, note: note ?? null, occurred_on: daysAgo(ago) }))

function makeEntry(e: Partial<Entry> & Pick<Entry, 'type' | 'amount_paise'>): Entry {
  return {
    id: `e${++seq}`, status: 'confirmed', party_id: null, party_name: null, note: null, occurred_on: daysAgo(0),
    auto_saved: false, review_reason: null, source: 'manual', created_at: new Date(Date.now() + seq).toISOString(), ...e,
  }
}

function withParty(e: Entry): Entry {
  const p = parties.find((x) => x.id === e.party_id)
  return { ...e, party_name: p?.display_name ?? null }
}

const SIGN: Partial<Record<EntryType, number>> = { credit_given: 1, payment_received: -1, purchase_credit: -1, payment_made: 1 }
function balance(p: P): Party {
  const mine = entries.filter((e) => e.party_id === p.id && e.status === 'confirmed')
  return {
    party_id: p.id, display_name: p.display_name, kind: p.kind, needs_review: p.needs_review,
    balance_paise: mine.reduce((s, e) => s + (SIGN[e.type] ?? 0) * e.amount_paise, 0),
    last_activity: mine.map((e) => e.occurred_on).sort().at(-1) ?? null,
  }
}

function partyFor(name: string | undefined, kind: P['kind']): { id: string; created: boolean } {
  const n = (name ?? '').trim()
  const found = parties.find((p) => p.kind === kind && p.display_name.toLowerCase() === n.toLowerCase())
  if (found) return { id: found.id, created: false }
  const p = { id: `p${parties.length}`, display_name: n, kind, needs_review: true }
  parties.push(p)
  return { id: p.id, created: true }
}

function addWithRules(e: Partial<Entry> & Pick<Entry, 'type' | 'amount_paise'>, created: boolean) {
  const auto = e.amount_paise <= AUTO_SAVE_CAP_PAISE
  const entry = makeEntry({
    ...e, status: auto ? 'confirmed' : 'pending', auto_saved: auto,
    review_reason: auto ? (created ? 'new party created automatically' : null) : 'amount above ₹5,000',
  })
  entries.push(entry)
  return { decision: auto ? 'auto' : 'confirm', entry: withParty(entry), suggestion: null }
}

// Voice notes in demo mode rotate through a few canned sentences (no speech service is called).
const VOICE_SAMPLES: [string, EntryType, number][] = [
  ['Ramesh', 'credit_given', 250], ['Lakshmi', 'payment_received', 500], ['Suresh', 'credit_given', 6000],
]
let voiceTurn = 0
const TYPE_WORDS: Record<EntryType, string> = {
  credit_given: 'udhaar given', payment_received: 'payment received', cash_sale: 'cash sale',
  purchase_credit: 'purchase on credit', purchase_paid: 'purchase paid', payment_made: 'payment made', expense: 'expense',
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function demoApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase()
  const body = typeof init.body === 'string' ? JSON.parse(init.body) : {}
  const url = new URL(path, 'http://demo')
  const seg = url.pathname.split('/').filter(Boolean)
  await wait(method === 'GET' ? 120 : 400)

  const out = (v: unknown) => structuredClone(v) as T
  const entry = (id: string) => entries.find((e) => e.id === id)

  if (path === '/me') return out(ME)
  if (seg[0] === 'entries' && method === 'GET') {
    return out({ entries: [...entries].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 20).map(withParty) })
  }
  if (seg[0] === 'entries' && seg.length === 1 && method === 'POST') {
    const kind: P['kind'] | null = ['credit_given', 'payment_received'].includes(body.type) ? 'customer'
      : ['purchase_credit', 'payment_made'].includes(body.type) ? 'supplier' : null
    const e = makeEntry({ type: body.type, amount_paise: Math.round(body.amount_rupees * 100), note: body.note ?? null,
      party_id: kind ? partyFor(body.party_name, kind).id : null })
    entries.push(e)
    return out(withParty(e))
  }
  if (seg[0] === 'entries' && (seg[2] === 'confirm' || seg[2] === 'void')) {
    const e = entry(seg[1])
    if (e) e.status = seg[2] === 'confirm' ? 'confirmed' : 'voided'
    return out(withParty(e!))
  }
  if (seg[0] === 'parties' && seg.length === 1) {
    return out({ parties: parties.map(balance).sort((a, b) => a.display_name.localeCompare(b.display_name)) })
  }
  if (seg[0] === 'parties' && seg.length === 2) {
    const p = parties.find((x) => x.id === seg[1])
    if (!p) throw Object.assign(new Error('That party does not exist.'), { status: 404, code: 'not_found' })
    const b = balance(p)
    return out({ party: b, balance_paise: b.balance_paise,
      entries: entries.filter((e) => e.party_id === p.id && e.status !== 'voided').reverse().map(withParty) })
  }
  if (path === '/voice/entry') {
    await wait(900)
    const [name, type, rupees] = VOICE_SAMPLES[voiceTurn++ % VOICE_SAMPLES.length]
    const r = addWithRules({ type, amount_paise: rupees * 100, party_id: byName(name), source: 'voice' }, false)
    const said = `${name}, ${rupees} rupees ${TYPE_WORDS[type]}`
    return out({ ...r, speech_text: r.decision === 'auto' ? `${said}, saved.` : `${said}. Tap confirm to save.`,
      audio_b64: null, voice_note_id: 'demo', transcript_en: `(demo) ${said}` })
  }
  if (path === '/receipts') {
    const kind = init.body instanceof FormData ? init.body.get('kind') : 'supplier'
    const settled = init.body instanceof FormData ? init.body.get('settled') : null
    receiptKind = { kind: String(kind), settled: settled === null ? null : settled === 'true' }
    receiptReadyAt = Date.now() + 2500 // "reading" for a moment, like the real background job
    return out({ receipt_id: 'demo-receipt', status: 'queued' })
  }
  if (seg[0] === 'receipts' && seg.length === 2 && method === 'GET') {
    const ready = Date.now() >= receiptReadyAt
    return out({ receipt_id: 'demo-receipt', status: ready ? 'done' : 'processing', kind: receiptKind.kind,
      settled: receiptKind.settled, vendor_name: ready ? 'Shree Balaji Traders' : null, bill_date: ready ? daysAgo(2) : null,
      total_paise: ready ? 188_000 : null, retried_in_english: false, error: null })
  }
  if (seg[0] === 'receipts' && seg[2] === 'save') {
    const { kind, settled } = receiptKind
    const type: EntryType = kind === 'supplier' ? (settled ? 'purchase_paid' : 'purchase_credit')
      : kind === 'customer' ? (settled ? 'cash_sale' : 'credit_given') : 'expense'
    const party = kind === 'supplier' ? partyFor(body.vendor_name, 'supplier')
      : type === 'credit_given' ? partyFor(body.customer_name, 'customer') : null
    return out(addWithRules({ type, amount_paise: Math.round(body.total_rupees * 100), party_id: party?.id ?? null,
      note: party ? null : body.vendor_name ?? null, occurred_on: body.bill_date || daysAgo(0), source: 'receipt' },
    party?.created ?? false))
  }
  throw Object.assign(new Error('This part of the app is not in the demo.'), { status: 404, code: 'demo' })
}

let receiptKind: { kind: string; settled: boolean | null } = { kind: 'supplier', settled: false }
let receiptReadyAt = 0
