/** GOAL_2.0 P1.3: the raw transcript and the raw OCR text are one tap away on every result. */
import { expect, test } from '@playwright/test'
import { makePng, open } from './helpers'
import { MockApi, voiceResult } from './mock'

test('voice result card: WHAT I HEARD shows the exact transcript', async ({ page }) => {
  const m = new MockApi().seed()
  m.voiceQueue.push(() => voiceResult(m, { decision: 'auto', type: 'credit_given', rupees: 340, party: 'Ishaan Verma',
    speech: 'Ishaan Verma, 340 rupees udhaar, saved.', transcript: 'Gave Ishaan Verma 340 on credit.' }))
  await open(page, m, '/app')
  await page.getByRole('button', { name: 'Hold to add' }).press('Space', { delay: 900 })
  const heard = page.getByTestId('what-i-heard')
  await expect(heard).toBeVisible()
  await expect(heard.getByText('Gave Ishaan Verma 340 on credit.')).toBeHidden()   // closed by default
  await heard.getByText('What I heard').click()
  await expect(heard.getByText('“Gave Ishaan Verma 340 on credit.”')).toBeVisible()
})

test('clarify card for silence says nothing was heard', async ({ page }) => {
  const m = new MockApi().seed()
  m.voiceQueue.push(() => voiceResult(m, { decision: 'clarify', speech: "I didn't catch that. Hold the button and say it again.", transcript: '' }))
  await open(page, m, '/app')
  await page.getByRole('button', { name: 'Hold to add' }).press('Space', { delay: 900 })
  await expect(page.getByText("I didn't catch that. Hold the button and say it again.")).toBeVisible()
  await page.getByTestId('what-i-heard').getByText('What I heard').click()
  await expect(page.getByText('Nothing. The recording was silent.')).toBeVisible()
})

test('scan form: WHAT I READ shows the bill text', async ({ page }) => {
  const m = new MockApi().seed()
  m.nextReceipt = { status: 'done', vendor_name: 'Nilgiri Stores', bill_date: '2026-09-20', total_paise: 71550,
    ocr_text: 'NILGIRI STORES\nBill 20/09/2026\nTOTAL 715.50', total_check: 'ok' }
  await open(page, m, '/app/scan')
  await page.getByRole('button', { name: /Supplier/ }).click()
  await page.getByRole('button', { name: 'Credit' }).click()
  await page.locator('input[type=file]').setInputFiles({ name: 'bill.png', mimeType: 'image/png', buffer: makePng(800, 1100, [245, 243, 236]) })
  await page.getByRole('button', { name: 'Use this photo' }).click()
  const read = page.getByTestId('what-i-read')
  await expect(read).toBeVisible({ timeout: 15_000 })
  await read.getByText('What I read').click()
  await expect(read.getByText(/TOTAL 715\.50/)).toBeVisible()
})
