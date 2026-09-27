import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { fetchParties, type Party } from './ledger'
import { fetchMembers } from './members'
import { formatPaise } from './money'
import { supabase } from './supabase'
import { t } from '../strings'

// Everything a change in entries / parties / receipts can alter on screen.
const LIVE_KEYS = ['entries', 'entry', 'ledger', 'parties', 'party', 'review', 'insights', 'dashboard', 'activity', 'receipt', 'report']
const TABLES = ['entries', 'parties', 'receipts'] as const

type EntryRow = { id: string; created_by: string | null; amount_paise: number; party_id: string | null; note: string | null; type: string }

/**
 * Live sync (GOAL_2.0 P4.2): Supabase Realtime `postgres_changes` for this shop's entries, parties and
 * receipts, over the signed-in user's session, so RLS decides what arrives. Any change refreshes the
 * lists, balances, dashboard and review count. A new entry by someone else calls `onOtherAdded`
 * with "PRIYA ADDED ₹250 · RAMESH" (no Undo: Undo belongs to whoever made the entry, P4.5).
 */
export function useLiveSync(shopId: string | undefined, meId: string | undefined, onOtherAdded: (text: string) => void) {
  const qc = useQueryClient()
  const announce = useRef(onOtherAdded)
  useEffect(() => { announce.current = onOtherAdded })

  useEffect(() => {
    if (!shopId) return
    const refresh = () => LIVE_KEYS.forEach((key) => qc.invalidateQueries({ queryKey: [key] }))
    const channel = supabase.channel(`shop-${shopId}`)
    for (const table of TABLES) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table, filter: `shop_id=eq.${shopId}` }, async (p) => {
        refresh()
        const row = p.new as EntryRow
        if (table !== 'entries' || p.eventType !== 'INSERT' || !row.created_by || row.created_by === meId) return
        const members = await qc.fetchQuery({ queryKey: ['members'], queryFn: fetchMembers, staleTime: 60_000 }).catch(() => null)
        const who = members?.members.find((m) => m.user_id === row.created_by)?.display_name || t.live.someone
        const parties = row.party_id ? await qc.fetchQuery({ queryKey: ['parties'], queryFn: fetchParties, staleTime: 5_000 }).catch(() => null) : null
        const party = parties?.find((x: Party) => x.party_id === row.party_id)?.display_name
        announce.current(t.live.added(who, `${formatPaise(row.amount_paise)}${party ? ` · ${party}` : row.note ? ` · ${row.note}` : ''}`))
      })
    }
    channel.subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [shopId, meId, qc])
}
