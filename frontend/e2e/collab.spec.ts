/**
 * GOAL_2.0 P4: two people in one shop, live. The mock backend and a mock Realtime server are shared
 * by both browsers; a third browser is in another shop on the same Realtime server. (The real RLS
 * guarantee is tested against live Supabase Realtime in backend/tests/test_members.py.)
 */
import { expect, test, type Browser } from '@playwright/test'
import { shots } from './helpers'
import { MockApi, PRIYA, RealtimeHub, today, voiceResult, type MockUser } from './mock'

const OMAR: MockUser = { id: 'user-3', email: 'omar@example.com', user_metadata: { name: 'Omar' } }

async function browse(browser: Browser, m: MockApi, as: MockUser, path: string) {
  const ctx = await browser.newContext({ permissions: ['microphone'] })
  const page = await ctx.newPage()
  await m.install(page, as)
  await page.goto(path)
  return page
}

function twoPeople(hub = new RealtimeHub()) {
  const m = new MockApi().seed()
  m.hub = hub
  m.members.push({ user_id: PRIYA.id, display_name: 'Priya', role: 'staff', joined_at: '2026-09-10T00:00:00Z' })
  return m
}

test('A adds an entry; B sees it appear without reloading, with a toast that has no Undo', async ({ browser }) => {
  const hub = new RealtimeHub()
  const m = twoPeople(hub)
  const other = new MockApi()            // a different shop on the same Realtime server
  other.shop = { ...other.shop, id: 'shop-2', invite_code: 'ZZZ999' }
  other.users = [OMAR]
  other.members = [{ user_id: OMAR.id, display_name: 'Omar', role: 'owner', joined_at: '2026-09-01T00:00:00Z' }]
  other.hub = hub

  const a = await browse(browser, m, m.users[0], '/app/ledger')
  const b = await browse(browser, m, PRIYA, '/app/ledger')
  const c = await browse(browser, other, OMAR, '/app/ledger')
  await expect(a.getByRole('table')).toBeVisible()
  await expect(b.getByRole('table')).toBeVisible()
  for (const who of [m.users[0].id, PRIYA.id, OMAR.id]) await expect.poll(() => hub.subs.some((x) => x.user === who)).toBe(true)
  const before = await b.locator('tbody tr').count()

  await a.getByRole('button', { name: 'Add by hand' }).click()
  const form = a.getByTestId('manual-add')
  await form.getByLabel('Amount (₹) *').fill('640')
  await form.getByLabel('Customer or supplier name *').fill('Lakshmi')
  await form.getByRole('button', { name: 'Save entry' }).click()
  await expect(a.getByTestId('saved-add-another')).toBeVisible()

  // B: the row arrives on its own, and the toast names who did it. No Undo for someone else's entry.
  await expect(b.locator('tbody tr')).toHaveCount(before + 1)
  await expect(b.locator('tbody tr').first()).toContainText('₹640')
  const toast = b.getByTestId('live-toast')
  await expect(toast).toContainText('Asha added ₹640 · Lakshmi')
  await expect(toast.getByRole('button')).toHaveCount(0)
  await shots(b, 'P4-collab', 'b-sees-a-live')
  // A gets no "someone added" toast for its own entry.
  await expect(a.getByTestId('live-toast')).toHaveCount(0)
  // The other shop received nothing and shows nothing new.
  expect(hub.delivered[OMAR.id] ?? 0).toBe(0)
  await expect(c.getByTestId('live-toast')).toHaveCount(0)
  await expect(c.getByText('₹640')).toHaveCount(0)
})

test('Undo belongs to the creator: A gets the 5 s Undo, B only hears about it', async ({ browser }) => {
  const m = twoPeople()
  const a = await browse(browser, m, m.users[0], '/app')
  const b = await browse(browser, m, PRIYA, '/app')
  await expect.poll(() => m.hub.subs.some((x) => x.user === PRIYA.id)).toBe(true)
  m.voiceQueue.push(() => voiceResult(m, { decision: 'auto', type: 'credit_given', rupees: 275, party: 'Lakshmi', speech: 'Lakshmi, 275 rupees udhaar, saved.' }))
  await a.getByRole('button', { name: 'Hold to add' }).press('Space', { delay: 900 })
  await expect(a.getByRole('button', { name: 'Undo' })).toBeVisible()
  await expect(b.getByTestId('live-toast')).toContainText('Asha added ₹275 · Lakshmi')
  await expect(b.getByRole('button', { name: 'Undo' })).toHaveCount(0)
  // B's recent list refreshed too.
  await expect(b.getByText('₹275').first()).toBeVisible()
})

test('attribution: rows say who added them; entry shows confirmed by; history names the editor', async ({ page }) => {
  const m = twoPeople()
  const lakshmi = m.parties.find((p) => p.display_name === 'Lakshmi')!.id
  const e = m.entry({ type: 'credit_given', amount_paise: 710000, party_id: lakshmi, created_by: PRIYA.id, status: 'pending', occurred_on: today() })
  await m.install(page)
  await page.goto('/app')
  await expect(page.getByText(`Credit given · ${new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${today()}T12:00:00Z`)).replace('Sept', 'Sep')} · Added by Priya`)).toBeVisible()
  await page.goto(`/app/entries/${e.id}`)
  await expect(page.getByTestId('added-by')).toHaveText('Added by Priya')
  await page.getByRole('button', { name: 'Confirm' }).first().click()
  await expect(page.getByTestId('history-row').last()).toContainText('Asha (you)')
})

test('settings: members list with roles and joined dates; edit my own name', async ({ page }) => {
  const m = twoPeople()
  await m.install(page)
  await page.goto('/app/settings')
  const list = page.getByTestId('members')
  await expect(list).toContainText('Asha (you)')
  await expect(list).toContainText('Owner')
  await expect(list).toContainText('Priya')
  await expect(list).toContainText('Staff')
  await expect(list).toContainText('Joined 10 Sep 2026')
  await expect(page.getByTestId('invite-code')).toHaveText('K7Q2ZP')
  const name = page.getByTestId('my-name')
  await name.getByLabel('My name *').fill('Asha Kulkarni')
  await name.getByRole('button', { name: 'Save name' }).click()
  await expect(name.getByText('Name saved.')).toBeVisible()
  await expect(list).toContainText('Asha Kulkarni (you)')
  await shots(page, 'P4-collab', 'settings-members')
})

test('dashboard activity feed: who · what · when, newest first', async ({ page }) => {
  const m = twoPeople()
  const ramesh = m.parties.find((p) => p.display_name === 'Ramesh')!.id
  m.entry({ type: 'payment_received', amount_paise: 30000, party_id: ramesh, created_by: PRIYA.id })
  await m.install(page)
  await page.goto('/app/dashboard')
  const feed = page.getByTestId('activity-feed')
  await expect(feed.locator('li').first()).toContainText('Priya added Payment received · ₹300 · Ramesh')
  await expect(feed.locator('li').first()).toContainText('just now')
  await shots(page, 'P4-collab', 'activity')
})
