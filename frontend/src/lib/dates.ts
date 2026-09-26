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

const dayFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

/** "2026-09-26" → "26 Sep 2026" (GOAL_2.0 P8). */
export function formatDay(iso: string | null | undefined): string {
  if (!iso) return ''
  return dayFmt.format(new Date(`${iso.slice(0, 10)}T00:00:00Z`)).replace(/Sept/, 'Sep')
}
