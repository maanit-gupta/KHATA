import { expect, test, type Page } from '@playwright/test'
import { lastCall, open, shots } from './helpers'
import { MockApi, SILENT_MP3, voiceResult } from './mock'

/** Hold a hold-to-talk button for `ms` (Chromium's fake mic plays e2e/fixtures/voice.wav). */
async function hold(page: Page, name: RegExp | string, ms = 1300) {
  const btn = page.getByRole('button', { name })
  await btn.scrollIntoViewIfNeeded()
  const box = (await btn.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(ms)
  await page.mouse.up()
}

function weekly() {
  return {
    week_start: '2026-09-28', week_end: '2026-10-04', today: '2026-10-01',
    this_week: { cash_sales_paise: 125050, credit_given_paise: 50000, collected_paise: 20000, expenses_paise: 30000, purchases_paise: 0, supplier_paid_paise: 0, entry_count: 5 },
    last_week: { cash_sales_paise: 150000, credit_given_paise: 100000, collected_paise: 0, expenses_paise: 10000, purchases_paise: 0, supplier_paid_paise: 0, entry_count: 4 },
    top_debtors: [{ party_id: 'p-2', name: 'Lakshmi', balance_paise: 100000, days_since_last_activity: 6 }],
    narration: 'इस हफ्ते अब तक 1250.5 रुपये की नकद बिक्री हुई।', narration_en: 'So far this week, 1250.5 rupees in cash sales.',
  }
}

test('ledger: voice panel, weekly card, recent rows', async ({ page }) => {
  const m = new MockApi().seed()
  m.insights = weekly()
  await open(page, m, '/app')
  await expect(page.getByRole('button', { name: 'Hold to add' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Hold to ask' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Scan a bill' })).toBeVisible()
  const card = page.getByTestId('weekly-card')
  await expect(card.getByText('₹1,250.50')).toBeVisible()
  await expect(card.getByText('Last week, Mon–Sun: ₹1,500')).toBeVisible()
  await expect(card.getByText('इस हफ्ते अब तक')).toBeVisible()
  await expect(card.getByText('Owes you ₹1,000')).toBeVisible()
  await shots(page, 'P6-insights', 'ledger-with-week')
  await card.getByRole('button', { name: 'Play the summary' }).click()
  await expect.poll(() => lastCall(m, 'POST', '/tts')?.body).toEqual({ text: 'So far this week, 1250.5 rupees in cash sales.' })
})

test('voice entry: auto-saved with read-back, 5 s undo', async ({ page }) => {
  const m = new MockApi().seed()
  m.voiceQueue.push(() => voiceResult(m, { decision: 'auto', type: 'credit_given', rupees: 250, party: 'Ramesh',
    speech: 'रमेश, 250 रुपये उधार, सेव हो गया।', transcript: 'Gave Ramesh 250 on credit' }))
  await open(page, m, '/app')
  await hold(page, 'Hold to add')
  const card = page.getByTestId('result-card')
  await expect(card.getByText('₹250')).toBeVisible()
  await expect(card.getByText('Ramesh', { exact: true })).toBeVisible()
  await expect(card.getByText('रमेश, 250 रुपये उधार, सेव हो गया।')).toBeVisible()
  const upload = lastCall(m, 'POST', '/voice/entry')!
  expect(String((upload.body as Record<string, string>)._file)).toMatch(/audio\/webm/)
  await expect(page.getByRole('status').filter({ hasText: 'Saved · Ramesh · ₹250' })).toBeVisible()
  await shots(page, 'P3-voice', 'auto-saved-undo')
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(page.getByText('Undone.')).toBeVisible()
  expect(lastCall(m, 'POST', '/entries/')?.path).toMatch(/\/void$/)
})

test('voice entry: pending card → confirm, edit link', async ({ page }) => {
  const m = new MockApi().seed()
  m.voiceQueue.push(() => voiceResult(m, { decision: 'confirm', type: 'credit_given', rupees: 6000, party: 'Ramesh',
    reason: 'amount above ₹5,000', speech: 'Ramesh, 6,000 rupees udhaar. Tap confirm to save.' }))
  await open(page, m, '/app')
  await hold(page, 'Hold to add')
  const card = page.getByTestId('result-card')
  await expect(card.getByText('Amount above ₹5,000')).toBeVisible()
  await expect(card.getByRole('button', { name: 'Edit' })).toBeVisible()
  await shots(page, 'P3-voice', 'pending-card')
  await card.getByRole('button', { name: 'Confirm' }).click()
  await expect(page.getByTestId('result-card').getByText('Confirmed')).toBeVisible()
})

test('voice entry: did you mean → YES / NO, NEW PERSON', async ({ page }) => {
  const m = new MockApi().seed()
  m.voiceQueue.push(() => voiceResult(m, { decision: 'confirm', type: 'credit_given', rupees: 250, party: 'Ramesh',
    suggestion: 'Ramesh', reason: 'Did you mean Ramesh?', speech: 'Rakesh, 250 rupees udhaar. Did you mean Ramesh?' }))
  m.resolveQueue.push(() => {
    const e = m.entries.at(-1)!
    e.status = 'confirmed'; e.auto_saved = true
    return { decision: 'auto', entry: m.out(e), suggestion: null, speech_text: 'Ramesh, 250 rupees udhaar, saved.', audio_b64: SILENT_MP3, voice_note_id: e.voice_note_id }
  })
  await open(page, m, '/app')
  await hold(page, 'Hold to add')
  await expect(page.getByText('Did you mean Ramesh?').first()).toBeVisible()
  await shots(page, 'P3-voice', 'did-you-mean')
  await expect(page.getByRole('button', { name: 'No, new person' })).toBeVisible()
  await page.getByRole('button', { name: 'Yes, Ramesh' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Saved · Ramesh · ₹250' })).toBeVisible()
  expect(lastCall(m, 'POST', '/voice/entry/resolve')?.body).toMatchObject({ choice: 'use_suggested' })
})

test('voice entry: clarify question → HOLD TO ANSWER sends answer_to', async ({ page }) => {
  const m = new MockApi().seed()
  let questionId = ''
  m.voiceQueue.push(() => { const r = voiceResult(m, { decision: 'clarify', speech: 'रमेश ने कितने लिए?' }); questionId = r.voice_note_id!; return r })
  m.voiceQueue.push(() => voiceResult(m, { decision: 'auto', type: 'credit_given', rupees: 250, party: 'Ramesh', speech: 'Ramesh, 250 rupees udhaar, saved.' }))
  await open(page, m, '/app')
  await hold(page, 'Hold to add')
  await expect(page.getByText('रमेश ने कितने लिए?')).toBeVisible()
  await shots(page, 'P3-voice', 'clarify')
  await hold(page, 'Hold to answer')
  await expect(page.getByRole('status').filter({ hasText: 'Saved · Ramesh · ₹250' })).toBeVisible()
  expect(lastCall(m, 'POST', '/voice/entry')?.body).toMatchObject({ answer_to: questionId })
})

test('voice question: answer card with text and play control', async ({ page }) => {
  const m = new MockApi().seed()
  m.askQueue.push({ text: 'ரமேஷ் உங்களுக்கு 1800 ரூபாய் தர வேண்டும்.', audio_b64: SILENT_MP3, question_en: 'How much does Ramesh owe?' })
  await open(page, m, '/app')
  await hold(page, 'Hold to ask')
  const card = page.getByTestId('answer-card')
  await expect(card.getByText('ரமேஷ் உங்களுக்கு 1800 ரூபாய் தர வேண்டும்.')).toBeVisible()
  await expect(card.getByRole('button', { name: 'Play' })).toBeVisible()
  await shots(page, 'P4-ask', 'answer-card')
})

test('recording: a tap shorter than 0.7 s shows the hold toast and sends nothing', async ({ page }) => {
  const m = new MockApi().seed()
  await open(page, m, '/app')
  await hold(page, 'Hold to add', 150)
  await expect(page.getByText('Hold the button while speaking.')).toBeVisible()
  expect(lastCall(m, 'POST', '/voice/entry')).toBeUndefined()
})

test('recording: label, 30 s countdown hairline, ripple goes live', async ({ page }) => {
  const m = new MockApi().seed()
  await open(page, m, '/app')
  const btn = page.getByRole('button', { name: 'Hold to add' })
  const box = (await btn.boundingBox())!
  await page.mouse.move(box.x + 20, box.y + 20)
  await page.mouse.down()
  await expect(page.getByRole('button', { name: 'Listening… release to send' })).toBeVisible()
  const bar = page.getByTestId('record-countdown')
  await expect(bar).toBeVisible()
  const anim = await bar.evaluate((el) => getComputedStyle(el).animation)
  expect(anim).toContain('30s linear')
  await expect(page.locator('[data-intensity="live"]')).toBeVisible()
  await shots(page, 'P3-voice', 'recording')
  m.voiceQueue.push(() => voiceResult(m, { decision: 'auto', type: 'cash_sale', rupees: 20, speech: '20 rupees cash sale, saved.' }))
  await page.mouse.up()
})

test('recording: auto-sends at 30 s', async ({ page }) => {
  test.setTimeout(60_000)
  const m = new MockApi().seed()
  m.voiceQueue.push(() => voiceResult(m, { decision: 'auto', type: 'cash_sale', rupees: 20, speech: '20 rupees cash sale, saved.' }))
  await page.clock.install()
  await open(page, m, '/app')
  const btn = page.getByRole('button', { name: 'Hold to add' })
  const box = (await btn.boundingBox())!
  await page.mouse.move(box.x + 20, box.y + 20)
  await page.mouse.down()
  await expect(page.getByRole('button', { name: 'Listening… release to send' })).toBeVisible()
  await page.clock.runFor(30_500) // never released: the 30 s cap sends it
  await expect.poll(() => lastCall(m, 'POST', '/voice/entry'), { timeout: 10_000 }).toBeTruthy()
  await page.mouse.up()
})

test('microphone blocked → instruction screen', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'))
  })
  const m = new MockApi().seed()
  await open(page, m, '/app')
  await hold(page, 'Hold to add')
  const dialog = page.getByRole('alertdialog')
  await expect(dialog.getByText(/Microphone\s*is blocked\./)).toBeVisible()
  await expect(dialog.getByText('Find Microphone and choose Allow.')).toBeVisible()
  await shots(page, 'P3-voice', 'mic-blocked')
  await dialog.getByRole('button', { name: 'Close' }).click()
  await expect(dialog).toHaveCount(0)
})
