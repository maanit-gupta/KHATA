/**
 * GOAL_2.0 P6: the dashboard as a shopkeeper reads it. The API is mocked with a fixture
 * (e2e/dashboard.fixture.ts); the SQL behind every number is tested in backend/tests/test_dashboard.py.
 */
import { expect, test } from '@playwright/test'
import { emptyDashboard, seededDashboard } from './dashboard.fixture'
import { lastCall, makePng, open, shots } from './helpers'
import { MockApi, today } from './mock'

function seeded() {
  const m = new MockApi().seed()
  const ids = {
    kavya: m.party('Kavya', 'customer'), arjun: m.party('Arjun', 'customer'), meena: m.party('Meena', 'customer'),
    lotus: m.party('Lotus Agencies', 'supplier'), balaji: m.party('Balaji Stores', 'supplier'),
  }
  m.dashboard = seededDashboard(ids)
  return { m, ids }
}

const short = (iso: string) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  .format(new Date(`${iso}T00:00:00Z`)).replace('Sept', 'Sep')

test('today strip, who owes me, what I owe, charts, register with weekly subtotals, top customers', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  const { m, ids } = seeded()
  await open(page, m, '/app/dashboard')
  const strip = page.getByTestId('today-strip')
  await expect(strip.locator('[data-metric="cash_sales"]')).toContainText('₹300')
  await expect(strip.locator('[data-metric="cash_sales"]')).toContainText(`+₹100 vs ${short(today(7))}`)
  await expect(strip.locator('[data-metric="credit_given"]')).toContainText(`−₹450 vs ${short(today(7))}`)
  await expect(strip.locator('[data-metric="collected"]')).toContainText(`Same as ${short(today(7))}`)

  const aging = page.getByTestId('aging')
  await expect(aging.getByTestId('aging-buckets').locator('[data-bucket="60+"]')).toContainText('₹800')
  await expect(aging.getByTestId('aging-buckets').locator('[data-bucket="31-60"]')).toContainText('0 customers')
  await expect(aging.locator('tbody tr').first()).toContainText('Arjun')
  await expect(aging.locator('[data-party="Kavya"]')).toContainText('10 days')
  await expect(aging.locator('[data-party="Arjun"]')).toContainText('Never')
  await expect(aging).toContainText('Age = days since their last payment')
  await expect(page.getByTestId('dues').locator('[data-party="Lotus Agencies"]')).toContainText('₹600')

  for (const id of ['chart-sales', 'chart-outstanding', 'chart-expenses']) {
    await expect(page.getByTestId(id).locator('svg.recharts-surface')).toBeVisible()
  }
  await expect(page.getByTestId('chart-expenses')).toContainText('Rent')
  await expect(page.getByTestId('chart-expenses')).toContainText('Uncategorised')
  // Flat and square: no gradients, no rounded bars.
  expect(await page.locator('[data-testid^="chart-"] linearGradient, [data-testid^="chart-"] radialGradient').count()).toBe(0)
  expect(await page.locator('[data-testid="chart-expenses"] .recharts-bar-rectangle path').first().getAttribute('d')).not.toMatch(/A/)

  const reg = page.getByTestId('register')
  await expect(reg.locator('tr[data-day]')).toHaveCount(30)
  const weekRows = reg.locator('tr[data-week]')
  expect(await weekRows.count()).toBeGreaterThanOrEqual(5)
  await expect(reg.locator('tbody tr').first()).toHaveAttribute('data-day', today(0))       // newest first
  await expect(reg.locator(`tr[data-day="${today(0)}"]`)).toContainText('₹190')              // net = 300 − 110
  await expect(reg.locator(`tr[data-day="${today(1)}"]`)).toContainText('−₹300')
  await expect(page.getByTestId('net-help')).toHaveText('Net cash in hand = cash sales + collected − purchases paid in cash − supplier paid − expenses.')
  await shots(page, 'P6-dashboard', 'dashboard')

  // Sort by net cash: largest first, and the weekly subtotals step aside.
  const netHeader = reg.getByRole('columnheader', { name: /Net cash in hand/ })
  await netHeader.getByRole('button').click()
  await expect(netHeader).toHaveAttribute('aria-sort', 'descending')
  await expect(reg.locator('tbody tr').first()).toHaveAttribute('data-day', today(12))
  await expect(weekRows).toHaveCount(0)
  await netHeader.getByRole('button').click()
  await expect(netHeader).toHaveAttribute('aria-sort', 'ascending')
  await expect(reg.locator('tbody tr').first()).toHaveAttribute('data-day', today(1))

  await expect(page.getByTestId('top-credit').locator('tbody tr').first()).toContainText('Kavya')
  await expect(page.getByTestId('top-credit').locator('tbody tr').first()).toContainText('₹700')
  await expect(page.getByTestId('top-collections').locator('tbody tr').nth(1)).toContainText('₹50')

  // Rows open the party statement.
  await aging.getByRole('link', { name: 'Kavya' }).click()
  await expect(page).toHaveURL(new RegExp(`/app/parties/${ids.kavya}`))
  await expect(page.getByTestId('statement-table').or(page.getByText('No confirmed entries in these dates.'))).toBeVisible()
})

test('empty shop: zeros and plain sentences, nothing broken', async ({ page }) => {
  const m = new MockApi()
  m.dashboard = emptyDashboard()
  await open(page, m, '/app/dashboard')
  await expect(page.getByTestId('today-strip')).toContainText('₹0')
  await expect(page.getByText('Nobody owes you anything right now.')).toBeVisible()
  await expect(page.getByText('You owe no supplier anything right now.')).toBeVisible()
  await expect(page.getByText('No expenses this month yet.')).toBeVisible()
  await expect(page.getByTestId('register').locator('tr[data-day]')).toHaveCount(30)
  await expect(page.getByTestId('top-credit')).toContainText('No customer entries this month yet.')
  await shots(page, 'P6-dashboard', 'empty')
})

test('phone: tables scroll in their boxes, the page never scrolls sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const { m } = seeded()
  await open(page, m, '/app/dashboard')
  await expect(page.getByTestId('register')).toBeVisible()
  await expect(page.getByTestId('chart-sales').locator('svg.recharts-surface')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  expect(await page.getByTestId('register-scroll').evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
})

test('expense categories: chips on quick add, the bill form and entry edit', async ({ page }) => {
  const m = new MockApi().seed()
  await open(page, m, '/app/ledger')
  await page.getByRole('button', { name: 'Add by hand' }).click()
  const form = page.getByTestId('manual-add')
  await expect(form.getByTestId('category-chips')).toHaveCount(0)             // only for expenses
  await form.getByRole('button', { name: 'Expense' }).click()
  const chips = form.getByTestId('category-chips')
  for (const c of ['Shop supplies', 'Rent', 'Electricity', 'Wages', 'Transport', 'Repairs', 'Other']) await expect(chips.getByRole('button', { name: c })).toBeVisible()
  await chips.getByRole('button', { name: 'Electricity' }).click()
  await expect(chips.getByRole('button', { name: 'Electricity' })).toHaveAttribute('aria-pressed', 'true')
  await form.getByLabel('Amount (₹) *').fill('1450')
  await form.getByRole('button', { name: 'Save entry' }).click()
  await expect(page.getByTestId('saved-add-another')).toBeVisible()
  expect(lastCall(m, 'POST', '/entries')?.body).toMatchObject({ type: 'expense', amount_rupees: 1450, expense_category: 'electricity' })

  const e = m.entries.find((x) => x.amount_paise === 145000)!
  await page.goto(`/app/entries/${e.id}`)
  const edit = page.getByTestId('category-chips')
  await expect(edit.getByRole('button', { name: 'Electricity' })).toHaveAttribute('aria-pressed', 'true')
  await edit.getByRole('button', { name: 'Repairs' }).click()
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect.poll(() => lastCall(m, 'PATCH', `/entries/${e.id}`)?.body).toEqual({ expense_category: 'repairs' })
})

test('expense bill: the category chip is sent with the save', async ({ page }) => {
  const m = new MockApi().seed()
  m.nextReceipt = { status: 'done', vendor_name: 'Power Board', bill_date: today(1), total_paise: 145000, total_check: 'ok', ocr_text: 'BILL 1450' }
  await open(page, m, '/app/scan')
  await page.getByRole('button', { name: /Expense/ }).click()
  await page.locator('input[type=file]').first().setInputFiles({ name: 'bill.png', mimeType: 'image/png', buffer: makePng(900, 1300, [246, 244, 238]) })
  await page.getByRole('button', { name: 'Use this photo' }).click()
  const form = page.getByTestId('bill-form')
  await expect(form.getByLabel('Vendor')).toHaveValue('Power Board', { timeout: 10_000 })
  await form.getByTestId('category-chips').getByRole('button', { name: 'Electricity' }).click()
  await form.getByRole('button', { name: 'Save entry' }).click()
  await expect(page.getByTestId('saved-entry')).toBeVisible()
  expect(m.calls.find((c) => c.method === 'POST' && c.path.endsWith('/save'))?.body).toMatchObject({ expense_category: 'electricity' })
  expect(m.entries.at(-1)?.expense_category).toBe('electricity')
})
