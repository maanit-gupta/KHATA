import { expect, test } from '@playwright/test'
import { lastCall, open, shots } from './helpers'
import { MockApi } from './mock'

test('settings: language, voice sample, invite code, log out', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const m = new MockApi().seed()
  await open(page, m, '/app/settings')
  await expect(page.getByTestId('invite-code')).toHaveText('K7Q2ZP')
  await shots(page, 'P5.3-settings', 'settings')

  await page.getByRole('button', { name: /My language/ }).click()
  await page.getByRole('radio', { name: 'தமிழ்' }).click()
  await expect.poll(() => m.lang).toBe('ta-IN')
  expect(lastCall(m, 'PATCH', '/me')?.body).toEqual({ lang: 'ta-IN' })

  await page.getByRole('button', { name: /Voice/ }).click()
  await expect(page.getByRole('radio', { name: 'varun' })).toHaveCount(0)
  await expect(page.getByRole('radio').first()).toHaveText(/ratan/i) // Tamil's recommended voice first
  await shots(page, 'P5.3-settings', 'voice-picker')
  await page.getByRole('radio', { name: /^rohan/i }).click()
  await expect.poll(() => lastCall(m, 'POST', '/tts')?.body).toEqual({ text: 'Ramesh owes you 250 rupees.' })
  expect(lastCall(m, 'PATCH', '/me')?.body).toEqual({ tts_voice: 'rohan' })

  await page.getByRole('button', { name: 'Copy' }).click()
  await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('K7Q2ZP')

  await page.getByRole('button', { name: 'Log out' }).click()
  await expect(page).toHaveURL(/\/(login)?$/)
})
