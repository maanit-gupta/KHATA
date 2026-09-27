// Live check of P4.2 against real Supabase Realtime (no Sarvam/Groq calls): two members of one
// throwaway shop in two browsers on the local stack. A adds an entry by hand; B must see it arrive
// without reloading, with the "… added …" toast.
// Usage: node frontend/scripts/live_collab.mjs <creds.json>   (users[0] = A, users[1] = B)
import { readFileSync } from 'node:fs'
import { chromium } from '@playwright/test'

const users = JSON.parse(readFileSync(process.argv[2], 'utf8')).users
const out = new URL('../../artifacts/screens/P4-collab-live/', import.meta.url).pathname
const browser = await chromium.launch()
async function login(u) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  await page.goto('http://localhost:5173/login')
  await page.getByLabel('Email').fill(u.email)
  await page.getByLabel('Password').fill(u.password)
  await page.getByRole('button', { name: 'Log in' }).click()
  await page.waitForURL(/\/app/, { timeout: 30_000 })
  await page.goto('http://localhost:5173/app/ledger')
  await page.getByRole('heading', { name: /The whole/ }).waitFor()
  return page
}
try {
  const a = await login(users[0])
  const b = await login(users[1])
  await b.waitForTimeout(3000) // let the Realtime subscriptions settle
  const t0 = Date.now()
  await a.getByRole('button', { name: 'Add by hand' }).click()
  await a.getByLabel('Amount (₹) *').fill('515')
  await a.getByLabel('Customer or supplier name *').fill('Live Check')
  await a.getByRole('button', { name: 'Save entry' }).click()
  await a.getByTestId('saved-add-another').waitFor()
  await b.getByTestId('live-toast').waitFor({ timeout: 20_000 })
  console.log(`B's toast after ${((Date.now() - t0) / 1000).toFixed(1)} s: ${await b.getByTestId('live-toast').textContent()}`)
  await b.getByRole('cell', { name: 'Live Check' }).waitFor({ timeout: 10_000 })
  console.log('B shows the new row without reloading: yes')
  await b.screenshot({ path: `${out}b-sees-a-390.png`, fullPage: true })
} finally {
  await browser.close()
}
