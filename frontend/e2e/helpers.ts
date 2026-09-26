import { expect, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
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

/** A real PNG of one flat colour (w×h), for photo fixtures: bright/large vs dark/small. */
export function makePng(w: number, h: number, rgb: [number, number, number]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td))
    return Buffer.concat([len, td, c])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3).map((_, i) => rgb[i % 3])])
  const raw = Buffer.concat(Array.from({ length: h }, () => row))
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
