import { ActivityFeed } from '../components/ActivityFeed'
import { t } from '../strings'
import { Screen } from './AppShell'

/** GOAL_2.0 P6 dashboard: "How is my shop doing, who owes me, what do I owe?" plus the activity
 * feed (P4.4). */
export function DashboardScreen() {
  return (
    <Screen title={t.dashboard.heading}>
      <div className="flex flex-col gap-12">
        <ActivityFeed />
      </div>
    </Screen>
  )
}
