import { useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { EntryList } from '../components/EntryList'
import { PartyStatement } from '../components/PartyStatement'
import { ButtonLink } from '../components/ui/Button'
import { SegmentChip } from '../components/ui/Chip'
import { Field } from '../components/ui/Field'
import { H2 } from '../components/ui/H2'
import { Row } from '../components/ui/Row'
import { useReveal } from '../hooks/useReveal'
import { balanceText, useParties, useParty, type Entry } from '../lib/ledger'
import { openBill, playRecording } from '../lib/media'
import { t } from '../strings'
import { Screen } from './AppShell'

type KindFilter = 'customer' | 'supplier' | null

export function PartiesScreen() {
  const parties = useParties()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [kind, setKind] = useState<KindFilter>(null)
  const reveal = useReveal({ key: 'parties' })
  const needle = q.trim().toLowerCase()
  const shown = parties.data?.filter((p) => (!kind || p.kind === kind) && (!needle || p.display_name.toLowerCase().includes(needle)))
  return (
    <Screen title={t.screens.parties}>
      <div className="mb-8 flex flex-col gap-4">
        <Field label={t.parties.search} type="search" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
        <div className="flex gap-2" role="group" aria-label={t.parties.filter}>
          {(['customer', 'supplier'] as const).map((k) => (
            <SegmentChip key={k} selected={kind === k} onClick={() => setKind(kind === k ? null : k)}>
              {k === 'customer' ? t.parties.customers : t.parties.suppliers}
            </SegmentChip>
          ))}
        </div>
      </div>
      {parties.error && <p className="t-body-lg" role="alert">{parties.error.message}</p>}
      {parties.data && !parties.data.length && <p className="t-body-lg">{t.parties.empty}</p>}
      {parties.data && parties.data.length > 0 && shown?.length === 0 && <p className="t-body-lg">{t.parties.noMatch}</p>}
      <div className="border-b border-ink">
        {shown?.map((p, i) => (
          <Row key={p.party_id} index={i} animate={reveal.animate} status="confirmed" isNew={p.needs_review}
            right={<span className="t-label">{balanceText(p.balance_paise)}</span>}
            onClick={() => navigate(`/app/parties/${p.party_id}`)}>
            {p.display_name}
          </Row>
        ))}
      </div>
    </Screen>
  )
}

export function PartyDetailScreen() {
  const { id = '' } = useParams()
  const q = useParty(id)
  const p = q.data?.party
  const [evidenceError, setEvidenceError] = useState<string | null>(null)
  const fail = (e: unknown) => setEvidenceError((e as Error).message)

  const evidence = (e: Entry) => (
    <>
      {e.voice_note_id && (
        <button type="button" aria-label={t.parties.playRecording} onClick={() => playRecording(e.voice_note_id!).catch(fail)}
          className="inline-flex size-12 items-center justify-center bg-ink text-paper">
          <span aria-hidden className="text-[14px] leading-none">▶</span>
        </button>
      )}
      {e.receipt_id && (
        <button type="button" aria-label={t.parties.openBill} onClick={() => openBill(e.receipt_id!).catch(fail)}
          className="inline-flex size-12 items-center justify-center border border-ink t-label-lg">
          <span aria-hidden>{t.arrow}</span>
        </button>
      )}
    </>
  )

  return (
    <div className="grid gap-8 gutter-x py-10 app:grid-cols-3 app:py-16">
      <div className="flex flex-col gap-4">
        {p ? (
          <>
            <p className="t-label">{p.kind === 'customer' ? t.parties.customer : t.parties.supplier}{p.needs_review && ` · ${t.status.new}`}</p>
            <H2 lines={[p.display_name]} as="h1" />
            <p className="t-amount uppercase" data-testid="party-balance">{balanceText(p.balance_paise)}</p>
          </>
        ) : (
          <H2 lines={t.screens.partyDetail} as="h1" />
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-8 app:col-span-2">
        {q.error && <p className="t-body-lg" role="alert">{q.error.message}</p>}
        {evidenceError && <p className="t-body-lg" role="alert">{evidenceError}</p>}
        <section className="flex flex-col gap-4" aria-labelledby="entries-title">
          <h2 id="entries-title" className="t-h3">{t.parties.entriesTitle}</h2>
          <EntryList entries={q.data?.entries} revealKey={`party-${id}`} aside={evidence}
            empty={<p className="t-body-lg">{t.parties.noEntries}</p>} />
        </section>
        {p && <PartyStatement partyId={id} name={p.display_name} />}
        <ButtonLink to="/app/parties" variant="outline">{t.parties.back}</ButtonLink>
      </div>
    </div>
  )
}
