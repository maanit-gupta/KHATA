import { useQuery } from '@tanstack/react-query'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { api } from '../lib/api'
import { todayIst } from '../lib/dates'
import { ENTRY_TYPES, NO_PARTY_TYPES, useLedgerMutation, type Entry, type EntryType, type ExpenseCategory } from '../lib/ledger'
import { t } from '../strings'
import { CategoryChips } from './CategoryChips'
import { Button } from './ui/Button'
import { SegmentChip } from './ui/Chip'
import { Field } from './ui/Field'
import { StatusSquare } from './ui/StatusSquare'

type Suggestion = { party_id: string; display_name: string; kind: 'customer' | 'supplier' }

const kindFor = (type: EntryType): 'customer' | 'supplier' | null =>
  ['credit_given', 'payment_received', 'cash_sale'].includes(type) ? 'customer'
    : ['purchase_credit', 'purchase_paid', 'payment_made'].includes(type) ? 'supplier' : null

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const id = window.setTimeout(() => setV(value), ms)
    return () => window.clearTimeout(id)
  }, [value, ms])
  return v
}

/**
 * Quick manual add (GOAL_2.0 P3.4): type chips, amount on the decimal keypad, name autocomplete
 * from find_party (the same matcher voice uses), date defaulting to today in IST, Enter submits.
 * A save keeps the form open for the next entry: "SAVED. ADD ANOTHER".
 */
export function ManualAdd({ onSaved }: { onSaved?: (e: Entry) => void }) {
  const [type, setType] = useState<EntryType>('credit_given')
  const [amount, setAmount] = useState('')
  const [party, setParty] = useState('')
  const [picked, setPicked] = useState<Suggestion | null>(null)
  const [date, setDate] = useState(todayIst())
  const [note, setNote] = useState('')
  const [category, setCategory] = useState<ExpenseCategory | null>(null)
  const [savedOnce, setSavedOnce] = useState(false)
  const amountRef = useRef<HTMLInputElement>(null)
  const listId = useId()
  const needsParty = !NO_PARTY_TYPES.includes(type)
  const kind = kindFor(type)
  const q = useDebounced(party.trim(), 250)
  const suggest = useQuery({
    queryKey: ['suggest', q, kind],
    queryFn: () => api<{ parties: Suggestion[] }>(`/parties/suggest?q=${encodeURIComponent(q)}${kind ? `&kind=${kind}` : ''}`).then((r) => r.parties),
    enabled: q.length >= 2 && type !== 'expense' && picked?.display_name !== party,
    staleTime: 30_000,
  })
  const save = useLedgerMutation((body: object) => api<Entry>('/entries', { method: 'POST', body: JSON.stringify(body) }))

  function submit(ev: FormEvent) {
    ev.preventDefault()
    if (save.isPending) return
    const usePicked = picked && picked.display_name === party && picked.kind === kind
    save.mutate(
      { type, amount_rupees: Number(amount.replace(/,/g, '')), occurred_on: date,
        ...(type === 'expense' || !party.trim() ? {} : usePicked ? { party_id: picked.party_id } : { party_name: party.trim() }),
        note: note.trim() || undefined, ...(type === 'expense' && category ? { expense_category: category } : {}) },
      {
        onSuccess: (e) => {
          setSavedOnce(true)
          setAmount(''); setParty(''); setPicked(null); setNote(''); setCategory(null)
          amountRef.current?.focus()
          onSaved?.(e)
        },
      },
    )
  }

  const options = (suggest.data ?? []).filter((s) => s.display_name !== party)
  return (
    <form onSubmit={submit} className="flex flex-col gap-6 border-t border-ink pt-6" data-testid="manual-add">
      <fieldset>
        <legend className="mb-2 t-field-label">{t.ledger.type}</legend>
        <div className="flex flex-wrap gap-2">
          {ENTRY_TYPES.map((k) => (
            <SegmentChip key={k} selected={type === k} onClick={() => setType(k)}>{t.entryTypes[k]}</SegmentChip>
          ))}
        </div>
      </fieldset>
      <Field ref={amountRef} label={t.ledger.amount} required inputMode="decimal" autoComplete="off" value={amount}
        onChange={(e) => setAmount(e.target.value)} />
      {type !== 'expense' && (
        <div className="flex flex-col gap-2">
          <Field label={t.ledger.partyName} required={needsParty} value={party} autoComplete="off"
            aria-controls={listId}
            onChange={(e) => { setParty(e.target.value); setPicked(null) }} />
          {options.length > 0 && (
            <div id={listId} role="group" aria-label={t.manual.matches} className="flex flex-wrap gap-2">
              {options.map((s) => (
                <SegmentChip key={s.party_id} selected={false}
                  onClick={() => { setParty(s.display_name); setPicked(s) }}>{s.display_name}</SegmentChip>
              ))}
            </div>
          )}
        </div>
      )}
      {type === 'expense' && <CategoryChips value={category} onChange={setCategory} />}
      <Field label={t.manual.date} type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
      <Field label={t.ledger.note} value={note} onChange={(e) => setNote(e.target.value)} />
      {save.error && <p className="t-body" role="alert">{save.error.message}</p>}
      {savedOnce && !save.error && (
        <p className="flex items-center gap-3 t-label-lg" role="status" aria-live="polite" data-testid="saved-add-another">
          <StatusSquare status="confirmed" />{t.manual.savedAddAnother}
        </p>
      )}
      <Button type="submit" disabled={save.isPending}>{save.isPending ? t.ledger.working : t.ledger.save}</Button>
    </form>
  )
}
