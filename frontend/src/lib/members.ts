import { useQuery } from '@tanstack/react-query'
import { api } from './api'
import { t } from '../strings'

export type Member = { user_id: string; name: string; display_name: string | null; role: 'owner' | 'staff'; joined_at: string; you: boolean }

/** GET /members: everyone in the shop by name ("(you)" after your own) + the invite code (P4). */
export const fetchMembers = () => api<{ members: Member[]; invite_code: string }>('/members')

export const useMembers = () => useQuery({ queryKey: ['members'], queryFn: fetchMembers, staleTime: 5 * 60_000 })

const YOU = ' (you)'   // the API marks the caller's own name this way (backend app/members.py)

/** A name from the API, with its "(you)" and "Member" in the on-screen language (GOAL_2.0 P5.2). */
export function shown(name: string | null | undefined): string {
  if (!name) return ''
  if (name.endsWith(YOU)) return t.live.you(name.slice(0, -YOU.length))
  return name === 'Member' ? t.live.member : name
}

/** user id → name, for "Added by" labels. Unknown ids read as "Member". */
export function nameOf(members: Member[] | undefined, id: string | null | undefined): string | null {
  if (!id) return null
  return shown(members?.find((m) => m.user_id === id)?.name ?? 'Member')
}
