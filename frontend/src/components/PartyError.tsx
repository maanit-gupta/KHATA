import { Link } from 'react-router'
import { ApiError } from '../lib/api'
import { t } from '../strings'

/** A party save error. A name clash (the unique index) says which party has the name and offers to
 * open it: "Already exists: Ramesh. Open it" (GOAL_2.0 P8). */
export function PartyError({ error }: { error: Error | null }) {
  if (!error) return null
  const d = error instanceof ApiError && error.code === 'name_taken' ? error.details : null
  if (d?.party_id) {
    return (
      <p className="t-body" role="alert" data-testid="name-taken">
        {t.parties.exists(String(d.party_name))}{' '}
        <Link to={`/app/parties/${String(d.party_id)}`} className="inline-flex min-h-12 items-center underline underline-offset-4">{t.parties.openIt}</Link>
      </p>
    )
  }
  return <p className="t-body" role="alert">{error.message}</p>
}
