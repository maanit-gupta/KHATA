import { expect, test } from '@playwright/test'
import { open, shots } from './helpers'
import { MockApi } from './mock'

test('offline: a failed request shows the overlay; RETRY clears it once the server answers', async ({ page }) => {
  const m = new MockApi().seed()
  m.offline = true
  await open(page, m, '/app')
  const overlay = page.getByTestId('offline')
  await expect(overlay.getByRole('heading', { name: /No internet\.\s*Entries can’t be saved right now\./ })).toBeVisible()
  await shots(page, 'P8.1-offline', 'offline-overlay')
  await overlay.getByRole('button', { name: 'Retry' }).click()
  await expect(overlay.getByText('Still no connection. Check your internet, then retry.')).toBeVisible()
  m.offline = false
  await overlay.getByRole('button', { name: 'Retry' }).click()
  await expect(overlay).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Hold to add' })).toBeVisible()
})

test('offline: the browser going offline shows the overlay; coming back online clears it', async ({ page, context }) => {
  const m = new MockApi().seed()
  await open(page, m, '/app')
  await expect(page.getByRole('button', { name: 'Hold to add' })).toBeVisible()
  await context.setOffline(true)
  await expect(page.getByTestId('offline')).toBeVisible()
  await context.setOffline(false)
  await expect(page.getByTestId('offline')).toHaveCount(0)
})

test('API errors show their plain message', async ({ page }) => {
  const m = new MockApi().seed()
  m.voiceQueue.push({ status: 503, error: { code: 'service_busy', message: 'Service busy, try again.' } })
  await open(page, m, '/app')
  const btn = page.getByRole('button', { name: 'Hold to add' })
  const box = (await btn.boundingBox())!
  await page.mouse.move(box.x + 20, box.y + 20)
  await page.mouse.down()
  await page.waitForTimeout(1200)
  await page.mouse.up()
  await expect(page.getByRole('alert').filter({ hasText: 'Service busy, try again.' })).toBeVisible()

  m.failNext['POST entries'] = { status: 422, error: { code: 'bad_amount', message: 'That amount is too large. Check it and try again.' } }
  await page.getByRole('button', { name: 'Add by hand' }).click()
  await page.getByLabel('Amount (₹) *').fill('50')
  await page.getByLabel('Customer or supplier name *').fill('Ramesh')
  await page.getByRole('button', { name: 'Save entry' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'That amount is too large. Check it and try again.' })).toBeVisible()
})

test('cold start: "Waking the server…" after 3 s, then the app loads', async ({ page }) => {
  const m = new MockApi().seed()
  m.delayMs['GET me'] = 4500
  await open(page, m, '/app')
  await expect(page.getByText('Loading…')).toBeVisible()
  await expect(page.getByText('Waking the server…')).toBeVisible({ timeout: 4000 })
  await expect(page.getByText('The first request after a quiet spell can take up to a minute.')).toBeVisible()
  await shots(page, 'P8.6-cold-start', 'waking')
  await expect(page.getByRole('button', { name: 'Hold to add' })).toBeVisible({ timeout: 10_000 })
})
