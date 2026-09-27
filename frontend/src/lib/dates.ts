import { t, uiLang } from '../strings'

/** Dates in shop time (Asia/Kolkata, CLAUDE.md §9b), whatever the device's own time zone is. */
const IST_OFFSET_MS = 5.5 * 3600_000 // India has no daylight saving

/** Today's date in IST as YYYY-MM-DD. */
export function todayIst(now = Date.now()): string {
  return new Date(now + IST_OFFSET_MS).toISOString().slice(0, 10)
}

/** YYYY-MM-DD shifted by whole days. */
export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

const formats = new Map<string, Intl.DateTimeFormat>()

/** Month names follow the on-screen language (GOAL_2.0 P5.2); digits stay 0–9 in every language. */
export function dayFormat(lang: string = uiLang()): Intl.DateTimeFormat {
  let f = formats.get(lang)
  if (!f) {
    f = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC', numberingSystem: 'latn' })
    formats.set(lang, f)
  }
  return f
}

const shortFormats = new Map<string, Intl.DateTimeFormat>()

/** "2026-09-26" → "26 Sep" (chart axes, week labels), in the on-screen language. */
export function formatShortDay(iso: string, lang: string = uiLang()): string {
  let f = shortFormats.get(lang)
  if (!f) {
    f = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', timeZone: 'UTC', numberingSystem: 'latn' })
    shortFormats.set(lang, f)
  }
  return f.format(new Date(`${iso.slice(0, 10)}T00:00:00Z`)).replace(/Sept/, 'Sep')
}

/** "2026-09-26" → "26 Sep 2026" (GOAL_2.0 P8). */
export function formatDay(iso: string | null | undefined): string {
  if (!iso) return ''
  return dayFormat().format(new Date(`${iso.slice(0, 10)}T00:00:00Z`)).replace(/Sept/, 'Sep')
}

/** "just now", "2 min ago", "3 h ago", "yesterday", then "26 Sep 2026" (GOAL_2.0 P8, activity feed). */
export function relativeTime(iso: string, now = Date.now()): string {
  const secs = Math.max(0, Math.round((now - Date.parse(iso)) / 1000))
  if (secs < 45) return t.time.justNow
  const mins = Math.round(secs / 60)
  if (mins < 60) return t.time.minsAgo(mins)
  const hours = Math.round(mins / 60)
  if (hours < 24) return t.time.hoursAgo(hours)
  const day = (ms: number) => new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10)
  if (day(now - 86_400_000) === day(Date.parse(iso))) return t.time.yesterday
  return formatDay(day(Date.parse(iso)))
}
