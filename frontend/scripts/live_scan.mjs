// One live scan through the real UI (GOAL_2.0 P2 AC): local vite + local API + live Sarvam, as a
// throwaway user. Screenshots every step into artifacts/screens/P2-scan-live/.
// Usage: node frontend/scripts/live_scan.mjs <creds.json> <bill image> <expected total, e.g. 2464>
import { readFileSync } from 'node:fs'
import { chromium } from '@playwright/test'

const [credsPath, bill, expected] = process.argv.slice(2)
const creds = JSON.parse(readFileSync(credsPath, 'utf8')).users[0]
const out = new URL('../../artifacts/screens/P2-scan-live/', import.meta.url).pathname
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
const shot = (name) => page.screenshot({ path: `${out}${name}-390.png`, fullPage: true })
try {
  await page.goto('http://localhost:5173/login')
  await page.getByLabel('Email').fill(creds.email)
  await page.getByLabel('Password').fill(creds.password)
  await page.getByRole('button', { name: 'Log in' }).click()
  await page.waitForURL(/\/app/, { timeout: 30_000 })
  await page.goto('http://localhost:5173/app/scan')
  await page.getByRole('button', { name: /Supplier/ }).click()
  await page.getByRole('button', { name: 'Paid' }).click()
  await page.locator('input[type=file]').first().setInputFiles(bill)
  await page.getByRole('button', { name: 'Use this photo' }).waitFor()
  await shot('1-preview')
  const t0 = Date.now()
  await page.getByRole('button', { name: 'Use this photo' }).click()
  await page.getByTestId('scan-steps').waitFor()
  await shot('2-reading')
  const seen = new Set()
  while (!(await page.getByTestId('bill-form').count())) {
    const cur = await page.getByTestId('scan-steps').locator('li[data-state="pending"]').textContent().catch(() => null)
    if (cur) seen.add(cur)
    if (Date.now() - t0 > 200_000) throw new Error('no form after 200 s')
    await page.waitForTimeout(500)
  }
  console.log(`read in ${((Date.now() - t0) / 1000).toFixed(1)} s; steps seen: ${[...seen].join(' → ')}`)
  const total = await page.getByLabel('Total (₹) *').inputValue()
  const vendor = await page.getByLabel('Vendor *').inputValue()
  const date = await page.getByLabel('Bill date').inputValue()
  const hints = await page.locator('[data-hint]').allTextContents()
  console.log(JSON.stringify({ vendor, date, total, hints }))
  await page.getByTestId('what-i-read').locator('summary').click()
  await shot('3-review')
  await page.getByRole('button', { name: 'Save entry' }).click()
  await page.getByTestId('saved-entry').waitFor()
  await shot('4-saved')
  console.log(Number(total) === Number(expected) ? 'TOTAL OK' : `TOTAL MISMATCH (expected ${expected})`)
} finally {
  await browser.close()
}
