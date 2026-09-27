/**
 * GOAL_2.0 P5: a language per aspect. The four pickers, the on-screen text switching at once, the
 * mixed combination (speak Hindi, hear Tamil, English screens, Tamil reports), and long Indic labels
 * at phone width. (The spoken pipeline itself is tested against the real routes in
 * backend/tests/test_langs.py.)
 */
import { expect, test, type Page } from '@playwright/test'
import { lastCall, open, shots } from './helpers'
import { MockApi } from './mock'

async function pick(page: Page, aspect: string, lang: string) {
  const row = page.getByTestId('languages').getByRole('button', { name: new RegExp(aspect) })
  if (!(await page.getByRole('radiogroup', { name: aspect }).isVisible())) await row.click()
  await page.getByRole('radiogroup', { name: aspect }).getByRole('radio', { name: lang }).click()
}

test('four pickers, each in its own script; changing the screen language applies at once and sticks', async ({ page }) => {
  const m = new MockApi().seed()
  await open(page, m, '/app/settings')
  const langs = page.getByTestId('languages')
  for (const label of ['On-screen text', 'I speak in', 'Read-backs and answers in', 'Summaries and reports in']) {
    await expect(langs.getByRole('button', { name: new RegExp(label) })).toBeVisible()
  }
  await langs.getByRole('button', { name: /On-screen text/ }).click()
  const group = page.getByRole('radiogroup', { name: 'On-screen text' })
  for (const name of ['தமிழ்', 'हिन्दी', 'English', 'తెలుగు', 'ಕನ್ನಡ', 'മലയാളം']) await expect(group.getByRole('radio', { name })).toBeVisible()
  await expect(group.getByRole('radio', { name: 'English' })).toHaveAttribute('aria-checked', 'true')

  await group.getByRole('radio', { name: 'हिन्दी' }).click()
  expect(lastCall(m, 'PATCH', '/me')?.body).toEqual({ ui_lang: 'hi-IN' })
  await expect(page.getByRole('heading', { level: 1 })).toContainText('आपकी')             // no reload
  await expect(page.locator('html')).toHaveAttribute('lang', 'hi')
  await expect(page.getByTestId('languages')).toContainText('भाषाएँ')
  await page.reload()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('आपकी')
  await page.goto('/app')
  await expect(page.getByRole('button', { name: 'दबाकर जोड़ें' })).toBeVisible()
  // Amounts keep 0-9 digits and the ₹ format in every language.
  await expect(page.getByText('₹2,300').first()).toBeVisible()
})

test('mixed: speak Hindi, hear Tamil, English screens, Tamil reports', async ({ page }) => {
  const m = new MockApi().seed()           // speaks hi-IN; screens en-IN
  await open(page, m, '/app/settings')
  await pick(page, 'Read-backs and answers in', 'தமிழ்')
  await pick(page, 'Summaries and reports in', 'தமிழ்')
  await expect.poll(() => m.langs).toMatchObject({ ui_lang: 'en-IN', voice_lang: 'ta-IN', report_lang: 'ta-IN' })
  expect(m.lang).toBe('hi-IN')
  const langs = page.getByTestId('languages')
  await expect(langs.getByTestId('lang-lang')).toContainText('हिन्दी')
  await expect(langs.getByTestId('lang-voice_lang')).toContainText('தமிழ்')
  await expect(langs.getByTestId('lang-ui_lang')).toContainText('English')

  // The voice list follows the read-back language (Tamil's recommended voice first), and the sample
  // is spoken in it.
  await page.getByRole('button', { name: /^Voice/ }).click()
  await expect(page.getByRole('radiogroup', { name: 'Voice' }).getByRole('radio').first()).toHaveText(/ratan/i)
  await page.getByRole('radiogroup', { name: 'Voice' }).getByRole('radio', { name: /^rohan/i }).click()
  await expect.poll(() => m.ttsLangs.at(-1)).toBe('ta-IN')

  // The screens stay English; the weekly summary arrives in Tamil and plays as a report.
  await page.goto('/app')
  await expect(page.getByRole('button', { name: 'Hold to add' })).toBeVisible()
  const card = page.getByTestId('weekly-card')
  await expect(card).toContainText('[ta-IN] So far this week')
  await card.getByRole('button', { name: 'Play the summary' }).click()
  await expect.poll(() => lastCall(m, 'POST', '/tts')?.body).toMatchObject({ purpose: 'report' })
  expect(m.ttsLangs.at(-1)).toBe('ta-IN')

  // Auto-detect is a switch under "I speak in".
  await page.goto('/app/settings')
  await page.getByTestId('languages').getByRole('button', { name: /I speak in/ }).click()
  await page.getByTestId('speech-auto').click()
  await expect.poll(() => lastCall(m, 'PATCH', '/me')?.body).toEqual({ speech_auto: true })
  await expect(page.getByTestId('speech-auto')).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByTestId('lang-lang')).toContainText('Detect automatically')
})

for (const [lang, code] of [['en-IN', 'en'], ['hi-IN', 'hi'], ['ta-IN', 'ta'], ['ml-IN', 'ml']] as const) {
  test(`screens hold in ${lang}: no sideways scroll at phone width; screenshots`, async ({ page }) => {
    const m = new MockApi().seed()
    m.langs.ui_lang = lang
    await page.setViewportSize({ width: 390, height: 844 })
    await m.install(page)
    for (const path of ['/app', '/app/ledger', '/app/settings', '/app/parties', '/app/scan', '/app/dashboard']) {
      await page.goto(path)
      await expect(page.locator('html')).toHaveAttribute('lang', code)
      await page.waitForTimeout(300)
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      expect(overflow, `${path} overflows by ${overflow}px in ${lang}`).toBeLessThanOrEqual(0)
    }
    if (code !== 'ml') {
      await page.goto('/app/settings')
      await shots(page, 'P5-languages', `settings-${code}`)
      await page.goto('/app/ledger')
      await shots(page, 'P5-languages', `ledger-${code}`)
    }
  })
}
