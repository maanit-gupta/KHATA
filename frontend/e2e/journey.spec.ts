import { expect, test, type Page } from '@playwright/test'
import { lastCall, open } from './helpers'
import { MockApi, SILENT_MP3, voiceResult } from './mock'

const BILL = new URL('../../backend/tests/fixtures/receipts/printed_bill.png', import.meta.url).pathname

async function hold(page: Page, name: string, ms = 1300) {
  const btn = page.getByRole('button', { name })
  const box = (await btn.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(ms)
  await page.mouse.up()
}

/** GOAL.md P8.4: the whole first-day flow against the mocked backend, headless. */
test('journey: signup → onboarding → manual → voice → confirm/undo → parties → scan → review → settings', async ({ page }) => {
  test.setTimeout(90_000)
  const m = new MockApi()
  m.signedIn = false
  m.hasShop = false

  // Sign up
  await open(page, m, '/signup')
  await page.getByLabel('Your name *').fill('Asha')
  await page.getByLabel('Email *').fill('asha@example.com')
  await page.getByLabel('Password *').fill('correct-horse')
  await page.getByRole('button', { name: 'Create account' }).click()

  // Onboarding: create a shop, pick Hindi
  await expect(page).toHaveURL(/\/onboarding$/)
  await page.getByRole('button', { name: 'Create a shop' }).click()
  await page.getByLabel('Shop name *').fill('Sharma Kirana')
  await page.getByRole('button', { name: 'Next' }).click()
  await page.getByRole('radio', { name: 'हिन्दी' }).click()
  await page.getByRole('button', { name: 'Create shop' }).click()
  await expect(page).toHaveURL(/\/app$/)
  expect(lastCall(m, 'POST', '/shops')?.body).toEqual({ name: 'Sharma Kirana', lang: 'hi-IN' })
  await expect(page.getByText(/Hold ADD and say what happened,/)).toBeVisible()   // empty ledger

  // Manual entry
  await page.getByRole('button', { name: 'Add by hand' }).click()
  await page.getByLabel('Amount (₹) *').fill('300')
  await page.getByLabel('Customer or supplier name *').fill('Ramesh')
  await page.getByRole('button', { name: 'Save entry' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Saved · Ramesh · ₹300' })).toBeVisible()

  // Voice entry over ₹5,000 → pending → confirm
  m.voiceQueue.push(() => voiceResult(m, { decision: 'confirm', type: 'credit_given', rupees: 6000, party: 'Ramesh',
    reason: 'amount above ₹5,000', speech: 'रमेश, 6,000 रुपये उधार। सेव करने के लिए कन्फर्म दबाएँ।' }))
  await hold(page, 'Hold to add')
  const card = page.getByTestId('result-card')
  await expect(card.getByText('Amount above ₹5,000')).toBeVisible()
  await card.getByRole('button', { name: 'Confirm' }).click()
  await expect(card.getByText(/Confirmed/)).toBeVisible()

  // Voice entry auto-saved → undo within 5 s
  m.voiceQueue.push(() => voiceResult(m, { decision: 'auto', type: 'credit_given', rupees: 250, party: 'Ramesh',
    speech: 'रमेश, 250 रुपये उधार, सेव हो गया।' }))
  await hold(page, 'Hold to add')
  await expect(page.getByRole('status').filter({ hasText: 'Saved · Ramesh · ₹250' })).toBeVisible()
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(page.getByText('Undone.')).toBeVisible()
  expect(m.entries.find((e) => e.amount_paise === 25000)?.status).toBe('voided')

  // Parties → party detail (₹300 + ₹6,000 = ₹6,300; the undone ₹250 doesn't count)
  await page.goto('/app/parties')
  await expect(page.getByText('Owes you ₹6,300')).toBeVisible()
  await page.getByRole('button', { name: /Ramesh/ }).click()
  await expect(page.getByTestId('party-balance')).toHaveText(/owes you ₹6,300/i)

  // Scan a supplier credit bill with mocked OCR, edit the total, save
  await page.goto('/app/scan')
  await page.getByRole('button', { name: /Supplier/ }).click()
  await page.getByRole('button', { name: 'Credit' }).click()
  await page.locator('input[type=file]').setInputFiles(BILL)
  await expect(page.getByText('Reading the bill…')).toBeVisible()
  await expect(page.getByLabel('Vendor *')).toHaveValue('Shree Balaji Traders', { timeout: 10_000 })
  await expect(page.getByLabel('Total (₹) *')).toHaveValue('1880')
  await page.getByLabel('Total (₹) *').fill('1850')
  await page.getByRole('button', { name: 'Save entry' }).click()
  await expect(page.getByRole('heading', { name: /Bill\s*saved\./ })).toBeVisible()
  expect(lastCall(m, 'POST', '/receipts/')?.body).toMatchObject({ vendor_name: 'Shree Balaji Traders', total_rupees: 1850 })
  const polls = m.calls.filter((c) => c.method === 'GET' && c.path.startsWith('/receipts/')).length
  expect(polls).toBeGreaterThanOrEqual(2)

  // Review queue: the new supplier is flagged → keep it
  await page.goto('/app/review')
  const row = page.getByTestId('review-party')
  await expect(row.getByText('Shree Balaji Traders')).toBeVisible()
  await row.getByRole('button', { name: 'Keep as is' }).click()
  await expect(page.getByText('Nothing needs a look right now.')).toBeVisible()

  // Settings: switch language to Tamil, hear a voice
  await page.goto('/app/settings')
  await page.getByRole('button', { name: /My language/ }).click()
  await page.getByRole('radio', { name: 'தமிழ்' }).click()
  await expect.poll(() => m.lang).toBe('ta-IN')
  await page.getByRole('button', { name: /Voice/ }).click()
  await page.getByRole('radio', { name: /^ishita/i }).click()
  await expect.poll(() => lastCall(m, 'POST', '/tts')?.body).toEqual({ text: 'Ramesh owes you 250 rupees.' })
  expect(SILENT_MP3.length).toBeGreaterThan(0)
})
