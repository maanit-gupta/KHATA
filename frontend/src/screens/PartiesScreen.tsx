import { useNavigate, useParams } from 'react-router'
import { ButtonLink } from '../components/ui/Button'
import { Row } from '../components/ui/Row'
import { useParties, useParty } from '../lib/ledger'
import { formatPaise } from '../lib/money'
import { t } from '../strings/en'
import { Screen } from './AppShell'
import { EntryList } from './LedgerScreen'

function balanceText(paise: number) {
  if (paise > 0) return t.parties.owesYou(formatPaise(paise))
  if (paise < 0) return t.parties.youOwe(formatPaise(-paise))
  return t.parties.settled
}

export function PartiesScreen() {
  const parties = useParties()
  const navigate = useNavigate()
  return (
    <Screen title={t.screens.parties}>
      {parties.data && !parties.data.length && <p className="t-body-lg">{t.parties.empty}</p>}
      {parties.error && <p className="t-body-lg" role="alert">{parties.error.message}</p>}
      <div className="border-b border-ink">
        {parties.data?.map((p, i) => (
          <Row key={p.party_id} index={i} status="confirmed" isNew={p.needs_review}
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
  return (
    <Screen title={p ? [p.display_name, balanceText(p.balance_paise)] : t.screens.partyDetail}>
      {q.error && <p className="t-body-lg" role="alert">{q.error.message}</p>}
      <EntryList entries={q.data?.entries} empty={t.ledger.empty} />
      <ButtonLink to="/app/parties" variant="outline" className="mt-8">{t.parties.back}</ButtonLink>
    </Screen>
  )
}
