import { expect, test } from '@playwright/test'
import { lastCall, open, shots } from './helpers'
import { MockApi } from './mock'

test('parties: search, kind chips, explicit balance wording', async ({ page }) => {
  const m = new MockApi().seed()
  await open(page, m, '/app/parties')
  await expect(page.getByText('Owes you ₹1,800')).toBeVisible()
  await expect(page.getByText('You owe ₹1,000')).toBeVisible()
  await shots(page, 'P5.4-party', 'parties')
  await page.getByRole('button', { name: 'Suppliers' }).click()
  await expect(page.getByRole('button', { name: /Ramesh/ })).toHaveCount(0)
  await page.getByRole('button', { name: 'Suppliers' }).click()
  await page.getByLabel('Search by name').fill('laks')
  await expect(page.getByRole('button', { name: /Lakshmi/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Ramesh/ })).toHaveCount(0)
})

test('party detail: balance in Amount style, ▶ plays audio, → opens the bill', async ({ page, context }) => {
  const m = new MockApi().seed()
  const ramesh = m.parties.find((p) => p.display_name === 'Ramesh')!.id
  await open(page, m, `/app/parties/${ramesh}`)
  await expect(page.getByTestId('party-balance')).toHaveText(/owes you ₹1,800/i)
  await shots(page, 'P5.4-party', 'party-detail')
  await page.getByRole('button', { name: 'Play the recording' }).click()
  await expect.poll(() => lastCall(m, 'GET', '/media/voice/')?.path).toBe('/media/voice/vn-1')

  const gupta = m.parties.find((p) => p.display_name === 'Gupta Traders')!.id
  await page.goto(`/app/parties/${gupta}`)
  await expect(page.getByTestId('party-balance')).toHaveText(/you owe ₹1,000/i)
  const popup = context.waitForEvent('page')
  await page.getByRole('button', { name: 'Open the bill photo' }).click()
  const bill = await popup
  await expect.poll(() => bill.url()).toContain('/files/receipts/r-seed')
})
