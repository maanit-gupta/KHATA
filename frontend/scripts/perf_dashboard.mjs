// GOAL_2.0 P6 AC, browser half: time /app/dashboard on the seeded shop (backend/scripts/perf_dashboard.py)
// against the local stack (production build via `vite preview` on :5173, API on :8000, live Supabase).
// "Loaded" = the today strip, the aging table, the register and the charts are all on screen.
// Usage: node frontend/scripts/perf_dashboard.mjs <creds.json>
import { readFileSync, writeFileSync } from 'node:fs'
import { chromium } from '@playwright/test'

const [user] = JSON.parse(readFileSync(process.argv[2], 'utf8')).users
const outFile = new URL('../../artifacts/perf/dashboard.json', import.meta.url).pathname
const shotDir = new URL('../../artifacts/screens/P6-dashboard-live/', import.meta.url).pathname
const browser = await chromium.launch()
const runs = []
try {
  for (const width of [1280, 390]) {
    const ctx = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 } })
    const page = await ctx.newPage()
    await page.goto('http://localhost:5173/login')
    await page.getByLabel('Email').fill(user.email)
    await page.getByLabel('Password').fill(user.password)
    await page.getByRole('button', { name: 'Log in' }).click()
    await page.waitForURL(/\/app/, { timeout: 30_000 })
    for (let i = 0; i < 3; i++) {
      await page.goto('about:blank')
      const t0 = Date.now()
      await page.goto('http://localhost:5173/app/dashboard')
      await page.getByTestId('today-strip').waitFor()
      await page.getByTestId('aging').waitFor()
      await page.getByTestId('register').waitFor()
      await page.getByTestId('chart-sales').locator('svg.recharts-surface').waitFor()
      runs.push({ width, ms: Date.now() - t0, cold: i === 0 })
    }
    await page.waitForTimeout(800)
    await page.screenshot({ path: `${shotDir}dashboard-${width}.png`, fullPage: true })
    await ctx.close()
  }
} finally {
  await browser.close()
}
const all = runs.map((r) => r.ms).sort((a, b) => a - b)
const prev = JSON.parse(readFileSync(outFile, 'utf8'))
prev.browser_ms = { runs, median: all[Math.floor(all.length / 2)], max: all.at(-1),
  note: 'Full page: new navigation to /app/dashboard (session in storage) until the strip, aging, register and first chart are visible. Production build via vite preview; API on localhost; live Supabase.' }
writeFileSync(outFile, JSON.stringify(prev, null, 2))
console.log(JSON.stringify(prev.browser_ms, null, 2))
