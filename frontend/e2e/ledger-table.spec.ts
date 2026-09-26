/** GOAL_2.0 P3: the ledger table, party statement, CSV download and quick manual add. */
import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { lastCall, open, shots } from './helpers'
import { MockApi, today } from './mock'

function book() {
  const m = new MockApi().seed()
  m.members.push({ user_id: 'user-2', display_name: 'Priya', role: 'staff', joined_at: '2026-09-02T00:00:00Z' })
  const lakshmi = m.parties.find((p) => p.display_name === 'Lakshmi')!.id
  m.entry({ type: 'expense', amount_paise: 8000, note: 'tea for staff', occurred_on: today(), created_by: 'user-2' })
  m.entry({ type: 'credit_given', amount_paise: 90000, party_id: lakshmi, occurred_on: today(2), status: 'voided' })
  return m
}

test('desktop: every column, totals, filters, voided only when asked, search, row opens the entry', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  const m = book()
  await open(page, m, '/app/ledger')
  const table = page.getByRole('table', { name: 'Ledger entries, newest first' })
  await expect(table).toBeVisible()
  for (const c of ['Date', 'Party', 'Type', 'Amount', 'Source', 'Added by', 'Status']) {
    await expect(table.getByRole('columnheader', { name: c })).toHaveAttribute('scope', 'col')
  }
  await expect(table.locator('tbody tr')).toHaveCount(6)                        // voided hidden
  await expect(table.locator('tbody tr[data-status="voided"]')).toHaveCount(0)
  await expect(table.getByText('Priya')).toBeVisible()                           // added by another member
  await expect(table.getByText('Asha (you)').first()).toBeVisible()
  const totals = page.getByTestId('ledger-totals')
  await expect(totals).toContainText('₹450.50')                                  // cash in (confirmed only)
  await expect(totals).toContainText('₹3,000')                                   // credit given 2,300 + 700
  await shots(page, 'P3-ledger', 'table')

  await page.getByRole('button', { name: 'Voided' }).click()                    // show voided too
  await expect(table.locator('tbody tr[data-status="voided"]')).toHaveCount(1)
  await expect(table.locator('tbody tr[data-status="voided"]')).toHaveClass(/line-through/)
  await expect(totals).toContainText('₹3,000')                                   // still not counted
  expect(lastCall(m, 'GET', '/ledger')?.path).toContain('status=confirmed%2Cpending%2Cvoided')

  await page.getByRole('button', { name: 'Today', exact: true }).click()
  await expect(table.locator('tbody tr')).toHaveCount(2)
  expect(lastCall(m, 'GET', '/ledger')?.path).toContain(`from=${today()}`)
  await page.getByRole('button', { name: 'All', exact: true }).click()

  await page.getByLabel('Type').selectOption('credit_given')
  await expect(table.locator('tbody tr')).toHaveCount(3)
  await page.getByLabel('Type').selectOption('')

  await page.getByLabel('Search names and notes').fill('tea for')
  await expect(table.locator('tbody tr')).toHaveCount(1)
  await expect(table.getByText('tea for staff')).toBeVisible()
  await page.getByLabel('Added by').selectOption('user-2')
  await expect(table.locator('tbody tr')).toHaveCount(1)
  await page.getByRole('button', { name: 'Clear filters' }).click()
  await expect(table.locator('tbody tr')).toHaveCount(6)

  await table.getByText('Lakshmi').first().click()
  await expect(page).toHaveURL(/\/app\/entries\//)
})

test('phone: the table scrolls inside its box, the page never scrolls sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await open(page, book(), '/app/ledger')
  const box = page.getByTestId('ledger-table-scroll')
  await expect(box).toBeVisible()
  expect(await box.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await shots(page, 'P3-ledger', 'table-phone')
})

test('pagination: 50 per page, next and previous', async ({ page }) => {
  const m = new MockApi().seed()
  for (let i = 0; i < 60; i++) m.entry({ type: 'cash_sale', amount_paise: 100 + i, occurred_on: today(i % 9) })
  await open(page, m, '/app/ledger')
  const pager = page.getByTestId('pager')
  await expect(pager).toContainText('65 entries · Page 1 of 2')
  await expect(page.locator('tbody tr')).toHaveCount(50)
  await pager.getByRole('button', { name: 'Next' }).click()
  await expect(pager).toContainText('Page 2 of 2')
  await expect(page.locator('tbody tr')).toHaveCount(15)
  await expect(pager.getByRole('button', { name: 'Next' })).toBeDisabled()
  await pager.getByRole('button', { name: 'Previous' }).click()
  await expect(pager).toContainText('Page 1 of 2')
})

test('CSV download: the filtered view as a file', async ({ page }) => {
  const m = book()
  await open(page, m, '/app/ledger?type=expense')
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download CSV' }).click()])
  expect(download.suggestedFilename()).toBe('khata-ledger-test.csv')
  const text = readFileSync(await download.path(), 'utf8')
  expect(text.split('\n')[0]).toContain('Amount (₹)')
  expect(text).toContain('tea for staff')
  expect(lastCall(m, 'GET', '/ledger/export.csv')?.path).toContain('type=expense')
})

test('quick add: decimal keypad, name suggestions, IST date, Enter saves, stays open for the next one', async ({ page }) => {
  const m = book()
  await open(page, m, '/app/ledger')
  await page.getByRole('button', { name: 'Add by hand' }).click()
  const form = page.getByTestId('manual-add')
  await expect(form.getByLabel('Amount (₹) *')).toHaveAttribute('inputmode', 'decimal')
  await expect(form.getByLabel('Date *')).toHaveValue(today())
  await form.getByRole('button', { name: 'Payment received' }).click()
  await form.getByLabel('Amount (₹) *').fill('1,250.50')
  await form.getByLabel('Customer or supplier name *').fill('Lak')
  await form.getByRole('group', { name: 'Matching names' }).getByRole('button', { name: 'Lakshmi' }).click()
  await form.getByLabel('Note').press('Enter')
  await expect(page.getByTestId('saved-add-another')).toHaveText('Saved. Add another.')
  const body = lastCall(m, 'POST', '/entries')?.body as Record<string, unknown>
  expect(body).toMatchObject({ type: 'payment_received', amount_rupees: 1250.5, occurred_on: today() })
  expect(body.party_id).toBe(m.parties.find((p) => p.display_name === 'Lakshmi')!.id)
  await expect(form.getByLabel('Amount (₹) *')).toHaveValue('')
  await expect(form.getByLabel('Amount (₹) *')).toBeFocused()
  await expect(form.getByRole('button', { name: 'Payment received' })).toHaveAttribute('aria-pressed', 'true')
  await shots(page, 'P3-ledger', 'quick-add')
})

test('party statement: running balance, opening balance for a date range, share link', async ({ page }) => {
  const m = new MockApi().seed()
  const ramesh = m.parties.find((p) => p.display_name === 'Ramesh')!.id
  await open(page, m, `/app/parties/${ramesh}`)
  const st = page.getByTestId('statement-table')
  await expect(st).toBeVisible()
  await expect(st.locator('tbody tr')).toHaveCount(2)
  await expect(st.locator('tbody tr').nth(0)).toContainText('+₹2,300')
  await expect(st.locator('tbody tr').nth(1)).toContainText('−₹500')
  await expect(page.getByTestId('statement-closing')).toHaveText('Owes you ₹1,800')
  await page.getByLabel('From').fill(today(5))
  await expect(st.locator('tbody tr').first()).toContainText('Opening balance')
  await expect(st.locator('tbody tr').first()).toContainText('Owes you ₹2,300')
  await expect(page.getByRole('link', { name: 'Share statement' })).toHaveAttribute('href', new RegExp(`/app/report\\?party=${ramesh}&from=${today(5)}`))
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await shots(page, 'P3-ledger', 'statement')
})
