// GOAL_2.0 P7.4 AC: one live briefing generated and played in 2 languages, on the seeded shop
// (backend/scripts/perf_dashboard.py), against the local stack (vite preview :5173, API :8000 via
// serve_counted.py, so every Sarvam/Groq call lands in artifacts/live-calls.log).
// Only /app/report is visited besides Home, so the weekly card's narration is the only other paid call.
// Usage: node frontend/scripts/live_briefing.mjs <creds.json>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { chromium } from '@playwright/test'

const [user] = JSON.parse(readFileSync(process.argv[2], 'utf8')).users
const out = new URL('../../artifacts/briefing/', import.meta.url).pathname
mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const log = []
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  await page.goto('http://localhost:5173/login')
  await page.getByLabel(/Email|ईमेल/).fill(user.email)
  await page.getByLabel(/Password|पासवर्ड/).fill(user.password)
  await page.locator('form button[type=submit]').click()
  await page.waitForURL(/\/app/, { timeout: 30_000 })
  const token = await page.evaluate(() => JSON.parse(Object.entries(localStorage).find(([k]) => k.includes('auth-token'))[1]).access_token)
  for (const lang of ['hi-IN', 'ta-IN']) {
    const r = await fetch('http://localhost:8000/me', { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ report_lang: lang, ui_lang: 'en-IN' }) })
    if (!r.ok) throw new Error(`PATCH /me ${r.status}`)
    await page.evaluate(() => localStorage.removeItem('khata-briefing-closed'))
    await page.goto('http://localhost:5173/app')
    const card = page.getByTestId('briefing-card')
    await card.waitFor({ timeout: 60_000 })
    const text = await card.getByTestId('briefing-text').innerText()
    const audioResp = page.waitForResponse((res) => res.url().includes('/storage/v1/object/sign/voice/') && res.status() < 300, { timeout: 60_000 })
    const t0 = Date.now()
    await card.getByRole('button', { name: 'Play the briefing' }).click()
    const res = await audioResp
    const bytes = Buffer.from(await (await fetch(res.url())).arrayBuffer())
    writeFileSync(`${out}briefing-${lang.slice(0, 2)}.mp3`, bytes)
    await page.waitForTimeout(1500)
    const alert = await card.getByRole('alert').count()
    await page.screenshot({ path: `${out}briefing-${lang.slice(0, 2)}.png`, fullPage: false })
    // A replay: the stored audio, no new TTS call.
    const replay = page.waitForResponse((res2) => res2.url().includes('/briefing/audio'))
    await card.getByRole('button', { name: 'Play the briefing' }).click()
    const second = await (await replay).json()
    log.push({ lang, text, chars: text.length, audio_bytes: bytes.length, first_play_ms: Date.now() - t0, error_shown: alert > 0, replay_cached: second.cached })
  }
} finally {
  await browser.close()
}
writeFileSync(`${out}live.json`, JSON.stringify(log, null, 2))
console.log(JSON.stringify(log, null, 2))
