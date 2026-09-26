import { expect, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { MockApi } from './mock'

export const SCREENS_DIR = new URL('../../artifacts/screens/', import.meta.url).pathname

/** Install the mock API and open a route. */
export async function open(page: Page, m: MockApi, path: string) {
  await m.install(page)
  await page.goto(path)
}

/** GOAL.md §1.4: screenshot at 390px and 1280px into artifacts/screens/<task>/. */
export async function shots(page: Page, task: string, name: string) {
  mkdirSync(`${SCREENS_DIR}${task}`, { recursive: true })
  const original = page.viewportSize()
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
    await page.waitForTimeout(350) // page transition cover
    // Row line-draws and reveals run once; wait for every finite animation to end (the ribbed
    // glass ripple is infinite and keeps running).
    await page.evaluate(() => Promise.all(document.getAnimations()
      .filter((a) => a.effect?.getComputedTiming().endTime !== Infinity)
      .map((a) => a.finished.catch(() => undefined))))
    await page.waitForTimeout(1200) // framer-motion JS-driven draws
    await page.screenshot({ path: `${SCREENS_DIR}${task}/${name}-${width}.png`, fullPage: true })
  }
  if (original) await page.setViewportSize(original)
}

export async function expectNoApologies(page: Page) {
  await expect(page.locator('body')).not.toContainText(/sorry/i)
}

export function lastCall(m: MockApi, method: string, prefix: string) {
  return [...m.calls].reverse().find((c) => c.method === method && c.path.startsWith(prefix))
}
