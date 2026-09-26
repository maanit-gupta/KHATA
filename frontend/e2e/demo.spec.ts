import { expect, test, type Page } from '@playwright/test'

/** P9.1: /demo runs every screen on the in-browser sample shop (no API, no Supabase). */
async function hold(page: Page, name: string) {
  const btn = page.getByRole('button', { name })
  const box = (await btn.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(1100)
  await page.mouse.up()
}

test('demo mode: voice, did-you-mean, ask, weekly card, review, entry edit, settings', async ({ page }) => {
  test.setTimeout(60_000)
  await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }))
  const apiCalls: string[] = []
  page.on('request', (r) => { if (/api\.test|sb\.test/.test(r.url())) apiCalls.push(r.url()) })
  await page.goto('/demo')
  await expect(page).toHaveURL(/\/app$/)
  await expect(page.getByText(/Demo mode/)).toBeVisible()
  await expect(page.getByTestId('weekly-card')).toBeVisible()

  for (let i = 0; i < 3; i++) {
    await hold(page, 'Hold to add')
    await expect(page.getByRole('button', { name: 'Hold to add' })).toBeEnabled({ timeout: 5000 })
  }
  await hold(page, 'Hold to add') // 4th sample: Rakesh → Did you mean Ramesh?
  await page.getByRole('button', { name: 'Yes, Ramesh' }).click()
  await expect(page.getByRole('status').filter({ hasText: /Saved · Ramesh · ₹100/ })).toBeVisible()

  await hold(page, 'Hold to ask')
  await expect(page.getByTestId('answer-card')).toContainText('owes you')

  await page.getByRole('link', { name: /^Review/ }).click()   // in-app: a reload would reset the demo
  await expect(page.getByTestId('review-entry')).toHaveCount(1)
  await page.getByTestId('review-entry').getByRole('button', { name: 'Edit' }).click()
  await page.getByLabel('Amount (₹) *').fill('5500')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Amount: ₹6,000 → ₹5,500')).toBeVisible()

  await page.getByRole('link', { name: 'Settings' }).click()
  await expect(page.getByTestId('invite-code')).toHaveText('DEMO42')
  expect(apiCalls).toEqual([])
})
