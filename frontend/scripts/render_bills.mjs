// Renders synthetic bill HTML files to images for backend/scripts/harness.py (GOAL_2.0 P1.4
// fallback). Chromium shapes every Indic script correctly, which Python imaging can't.
// Usage: node frontend/scripts/render_bills.mjs <jobs.json>
//   jobs.json: [{ "html": "/abs/in.html", "out": "/abs/out.png|jpg", "width": 600, "quality": 62 }]
import { readFileSync } from 'node:fs'
import { chromium } from '@playwright/test'

const jobs = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const browser = await chromium.launch()
try {
  for (const job of jobs) {
    const page = await browser.newPage({ viewport: { width: job.width ?? 600, height: 400 }, deviceScaleFactor: job.scale ?? 2 })
    await page.goto(`file://${job.html}`)
    await page.waitForLoadState('networkidle')
    const jpeg = job.out.endsWith('.jpg')
    await page.screenshot({ path: job.out, fullPage: true, type: jpeg ? 'jpeg' : 'png', ...(jpeg ? { quality: job.quality ?? 70 } : {}) })
    await page.close()
    console.log(`rendered ${job.out}`)
  }
} finally {
  await browser.close()
}
