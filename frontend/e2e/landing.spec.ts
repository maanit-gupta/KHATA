import { expect, test } from '@playwright/test'
import { open, shots } from './helpers'
import { MockApi } from './mock'

test('landing: every DESIGN §7 section, nav chips, CTA', async ({ page }) => {
  const m = new MockApi()
  m.signedIn = false
  await open(page, m, '/')
  await expect(page.getByRole('heading', { level: 1, name: /Your khata,\s*by voice\./ })).toBeVisible()
  await expect(page.getByText("Speak an entry, scan a bill, ask what's owed.")).toBeVisible()
  for (const h of [/Three ways\s*to keep the book\./, /Built to\s*be trusted\./, /Say it\s*your way\./]) {
    await page.getByRole('heading', { name: h }).scrollIntoViewIfNeeded()
    await expect(page.getByRole('heading', { name: h })).toBeVisible()
  }
  for (const line of ['रमेश को 250 उधार दिया', 'ரமேஷுக்கு 250 ரூபாய் கடன் கொடுத்தேன்', 'Gave Ramesh 250 on credit']) {
    await expect(page.getByText(line)).toBeVisible()
  }
  await expect(page.getByText('Every entry keeps its recording.')).toBeVisible()
  await expect(page.getByRole('heading', { name: /Built\s*by\./ })).toHaveCount(0) // no public/founder.jpg
  await expect(page.getByRole('link', { name: 'github.com/maanit-gupta/KHATA' })).toBeVisible()
  await page.evaluate(() => window.scrollTo(0, 0))
  await shots(page, 'P7.1-landing', 'landing')
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.getByRole('button', { name: 'How it works' }).click()
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(300)
  await page.getByRole('link', { name: 'Get started' }).first().click()
  await expect(page).toHaveURL(/\/signup$/)
})

test('no demo mode: no demo links, /demo is not a route, and nothing canned answers (GOAL_2.0 P1.1)', async ({ page }) => {
  const m = new MockApi()
  m.signedIn = false
  await open(page, m, '/')
  await expect(page.getByRole('link', { name: /demo/i })).toHaveCount(0)
  await page.goto('/login')
  await expect(page.getByRole('button', { name: /demo/i })).toHaveCount(0)
  await page.goto('/demo')
  await expect(page.getByText('That page does not exist.')).toBeVisible()
  expect(await page.evaluate(() => sessionStorage.getItem('khata-demo'))).toBeNull()
})

test('reduced motion: no ripple animation, reveals instant, countdown still linear', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const m = new MockApi().seed()
  m.signedIn = false
  await open(page, m, '/')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  // No SVG turbulence ripple anywhere, and the ribs are static (no filter).
  await expect(page.locator('svg filter animate')).toHaveCount(0)
  expect(await page.locator('[data-intensity] > div[aria-hidden]').first().evaluate((el) => getComputedStyle(el).filter)).toBe('none')
  // Section headings are already revealed (no muted pre-reveal state) far down the page.
  await expect(page.getByRole('heading', { name: /Say it\s*your way\./ })).toHaveClass(/opacity-100/)
  await shots(page, 'P7.3-reduced-motion', 'landing-reduced')
})

test('normal motion: the ripple animates (control for the test above)', async ({ page }) => {
  const m = new MockApi()
  m.signedIn = false
  await open(page, m, '/')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  expect(await page.locator('svg filter animate').count()).toBeGreaterThan(0)
})

test('reduced motion: the recording countdown still runs, linearly', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const m = new MockApi().seed()
  await open(page, m, '/app')
  await expect(page.locator('svg filter animate')).toHaveCount(0)
  const btn = page.getByRole('button', { name: 'Hold to add' })
  const box = (await btn.boundingBox())!
  await page.mouse.move(box.x + 20, box.y + 20)
  await page.mouse.down()
  const bar = page.getByTestId('record-countdown')
  await expect(bar).toBeVisible()
  expect(await bar.evaluate((el) => getComputedStyle(el).animation)).toContain('30s linear')
  await page.mouse.up()
})
