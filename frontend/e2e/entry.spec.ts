import { expect, test } from '@playwright/test'
import { lastCall, open, shots } from './helpers'
import { MockApi } from './mock'

test('entry edit: every field, save, history shows old → new', async ({ page }) => {
  const m = new MockApi().seed()
  const e = m.entries[0] // Ramesh ₹2,300 credit, spoken
  m.history[e.id].push({ action: 'edit', at: '2026-09-20T10:00:00Z', by: 'another_member', changes: [{ field: 'note', old: null, new: 'rice' }] })
  await open(page, m, `/app/entries/${e.id}`)
  await expect(page.getByRole('heading', { name: /Edit\s*entry\./ })).toBeVisible()
  await expect(page.getByText('₹2,300').first()).toBeVisible()
  await expect(page.getByText('Another member')).toBeVisible()
  await shots(page, 'P5.2-entry', 'entry-edit')

  await page.getByLabel('Amount (₹) *').fill('2450.50')
  await page.getByLabel('Note').fill('two bags')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Changes saved.')).toBeVisible()
  expect(lastCall(m, 'PATCH', `/entries/${e.id}`)?.body).toEqual({ amount_rupees: 2450.5, note: 'two bags' })
  await expect(page.getByText('Amount: ₹2,300 → ₹2,450.50')).toBeVisible()
  await expect(page.getByTestId('history-row').last()).toContainText('You')
})

test('entry edit: type and party change', async ({ page }) => {
  const m = new MockApi().seed()
  const e = m.entries[2] // Lakshmi credit
  await open(page, m, `/app/entries/${e.id}`)
  await page.getByRole('button', { name: 'Payment received' }).click()
  await page.getByLabel('Customer or supplier *').fill('Ramesh')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Changes saved.')).toBeVisible()
  expect(lastCall(m, 'PATCH', `/entries/${e.id}`)?.body).toEqual({ type: 'payment_received', party_name: 'Ramesh' })
})

test('entry edit: void asks for confirmation', async ({ page }) => {
  const m = new MockApi().seed()
  const e = m.entries[4]
  await open(page, m, '/app')
  await page.getByRole('button', { name: /Cash sale/ }).first().click()
  await expect(page).toHaveURL(new RegExp(`/app/entries/${e.id}$`))
  await page.getByRole('button', { name: 'Void entry' }).click()
  await expect(page.getByText('Void this entry?')).toBeVisible()
  await shots(page, 'P5.2-entry', 'void-confirm')
  await page.getByRole('button', { name: 'Keep it' }).click()
  expect(m.entries[4].status).toBe('confirmed')
  await page.getByRole('button', { name: 'Void entry' }).click()
  await page.getByRole('button', { name: 'Yes, void it' }).click()
  await expect(page).toHaveURL(/\/app$/)
  expect(m.entries[4].status).toBe('voided')
})
