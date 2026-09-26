// Screenshots of the REAL app (local vite + local FastAPI + live Supabase), logged in as a
// throwaway user, for evidence that needs real data (GOAL_2.0 P1.3 and later live checks).
// Usage: node frontend/scripts/live_screens.mjs <plan.json>
//   plan: { "base": "http://localhost:5173", "email": "...", "password": "...",
//           "shots": [{ "path": "/app/entries/<id>", "open": ["what-i-heard"], "out": "/abs/file", "widths": [390, 1280] }] }
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { chromium } from '@playwright/test'

const plan = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
try {
  await page.goto(`${plan.base}/login`)
  await page.getByLabel('Email').fill(plan.email)
  await page.getByLabel('Password').fill(plan.password)
  await page.getByRole('button', { name: 'Log in' }).click()
  await page.waitForURL(/\/app/, { timeout: 30_000 })
  for (const shot of plan.shots) {
    for (const width of shot.widths ?? [390, 1280]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
      await page.goto(`${plan.base}${shot.path}`)
      for (const id of shot.open ?? []) {
        const d = page.getByTestId(id)
        await d.waitFor({ timeout: 30_000 })
        await d.locator('summary').click()
      }
      await page.waitForTimeout(1200)
      const out = `${shot.out}-${width}.png`
      mkdirSync(dirname(out), { recursive: true })
      await page.screenshot({ path: out, fullPage: true })
      console.log(`shot ${out}`)
    }
  }
} finally {
  await browser.close()
}
