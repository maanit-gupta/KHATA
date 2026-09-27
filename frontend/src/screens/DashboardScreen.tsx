import { lazy, Suspense } from 'react'
import { ActivityFeed } from '../components/ActivityFeed'
import { BriefingCard } from '../components/BriefingCard'
import { SummaryCard } from '../components/SummaryCard'
import { AgingTable, DuesTable, RegisterTable, TodayStrip, TopCustomers } from '../components/dashboard/Tables'
import { useDashboard } from '../lib/dashboard'
import { SkeletonBlock, SkeletonRows } from '../components/ui/Skeleton'
import { t } from '../strings'
import { Screen } from './AppShell'

// recharts is the heaviest thing on this screen: its own chunk, so the figures and tables show first.
// The download starts as soon as this screen's code runs, alongside the data, not after it.
const chartsChunk = import('../components/dashboard/Charts')
const DashboardCharts = lazy(() => chartsChunk.then((m) => ({ default: m.DashboardCharts })))

/**
 * GOAL_2.0 P6: "How is my shop doing, who owes me, what do I owe?" Every figure is a SQL result
 * (GET /dashboard); the activity feed (P4.4) sits at the end.
 */
export function DashboardScreen() {
  const q = useDashboard()
  const d = q.data
  return (
    <Screen title={t.dashboard.heading} wide>
      <div className="flex flex-col gap-14" data-testid="dashboard">
        {q.error && <p className="t-body-lg" role="alert">{q.error.message}</p>}
        {!d && !q.error && (
          <div className="flex flex-col gap-8">
            <SkeletonBlock className="h-32" />
            <SkeletonRows rows={5} />
            <SkeletonBlock className="h-[220px]" />
          </div>
        )}
        <BriefingCard />
        {d && (
          <>
            {d.register.days.every((x) => x.entry_count === 0) && d.aging.rows.length === 0 && d.dues.rows.length === 0 && (
              <p className="t-body-lg" data-testid="dashboard-empty">{t.dashboard.emptyShop}</p>
            )}
            <TodayStrip data={d} />
            <SummaryCard />
            <div className="grid gap-14 app:grid-cols-5">
              <div className="min-w-0 app:col-span-3"><AgingTable data={d} /></div>
              <div className="min-w-0 app:col-span-2"><DuesTable data={d} /></div>
            </div>
            <Suspense fallback={<SkeletonBlock className="h-[260px]" />}>
              <DashboardCharts data={d} />
            </Suspense>
            <RegisterTable data={d} />
          </>
        )}
        <div className="grid gap-14 app:grid-cols-2">
          {d && <TopCustomers data={d} />}
          <ActivityFeed />
        </div>
      </div>
    </Screen>
  )
}
