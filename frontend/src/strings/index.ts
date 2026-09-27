/**
 * UI language (GOAL_2.0 P5.2). loadUiLang() copies another language's strings into `t` in place (so
 * a module that kept `t.table` still sees the new text) and tells subscribers; the app root then
 * re-mounts under the new language (main.tsx). English ships in the main bundle; the other five load
 * on demand.
 */
import { en } from './en'

/** The shape every language file must have: English's keys, with any string values. */
type Widen<T> = T extends string ? string
  : T extends (...a: infer A) => infer R ? (...a: A) => Widen<R>
    : T extends readonly (infer U)[] ? readonly Widen<U>[]
      : T extends object ? { -readonly [K in keyof T]: Widen<T[K]> } : T
export type Strings = Widen<typeof en>

export type Lang = 'ta-IN' | 'hi-IN' | 'en-IN' | 'te-IN' | 'kn-IN' | 'ml-IN'
export const LANG_ORDER: Lang[] = ['ta-IN', 'hi-IN', 'en-IN', 'te-IN', 'kn-IN', 'ml-IN']
export const isLang = (v: unknown): v is Lang => typeof v === 'string' && (LANG_ORDER as string[]).includes(v)

type Tree = { [k: string]: unknown }
const isTree = (v: unknown): v is Tree => typeof v === 'object' && v !== null && !Array.isArray(v)

function clone<T>(v: T): T {
  if (Array.isArray(v)) return v.map(clone) as T
  if (isTree(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)])) as T
  return v
}

/** Overwrite `into` with `from`, keeping every nested object and array identity. */
function assign(into: Tree, from: Tree) {
  for (const [k, v] of Object.entries(from)) {
    const cur = into[k]
    if (Array.isArray(v) && Array.isArray(cur)) cur.splice(0, cur.length, ...v.map(clone))
    else if (isTree(v) && isTree(cur)) assign(cur, v)
    else into[k] = clone(v)
  }
}

export const t: Strings = clone(en)

const LOADERS: Record<Lang, () => Promise<Strings>> = {
  'en-IN': async () => en,
  'hi-IN': () => import('./hi').then((m) => m.hi),
  'ta-IN': () => import('./ta').then((m) => m.ta),
  'te-IN': () => import('./te').then((m) => m.te),
  'kn-IN': () => import('./kn').then((m) => m.kn),
  'ml-IN': () => import('./ml').then((m) => m.ml),
}

const STORE_KEY = 'khata-ui-lang'
let current: Lang = 'en-IN'
const listeners = new Set<() => void>()

export function uiLang(): Lang {
  return current
}

export function subscribeUiLang(fn: () => void) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/** Switch the on-screen language. Remembered on this device so the login page uses it next time. */
export async function loadUiLang(lang: Lang): Promise<void> {
  if (lang === current) return
  assign(t as Tree, (await LOADERS[lang]()) as Tree)
  current = lang
  document.documentElement.lang = lang.slice(0, 2)
  try { localStorage.setItem(STORE_KEY, lang) } catch { /* private mode: this visit only */ }
  listeners.forEach((l) => l())
}

/** The language this device used last (before anyone is signed in). */
export function savedUiLang(): Lang {
  try {
    const v = localStorage.getItem(STORE_KEY)
    return isLang(v) ? v : 'en-IN'
  } catch {
    return 'en-IN'
  }
}
