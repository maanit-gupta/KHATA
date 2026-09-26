/** Plain unit checks run by the Playwright runner (no browser page): D-028. */
import { expect, test } from '@playwright/test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { formatPaise } from '../src/lib/money'

test('formatPaise: en-IN grouping, paise only when non-zero (P1.4)', () => {
  expect(formatPaise(0)).toBe('₹0')
  expect(formatPaise(10)).toBe('₹0.10')
  expect(formatPaise(25000)).toBe('₹250')
  expect(formatPaise(125050)).toBe('₹1,250.50')
  expect(formatPaise(500000)).toBe('₹5,000')
  expect(formatPaise(500001)).toBe('₹5,000.01')
  expect(formatPaise(12500000)).toBe('₹1,25,000')      // lakh grouping
  expect(formatPaise(1234567890)).toBe('₹1,23,45,678.90') // crore grouping
})

function files(dir: string, ext: RegExp): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (['node_modules', '.venv', '__pycache__', 'dist', 'fixtures'].includes(name)) return []
    return statSync(p).isDirectory() ? files(p, ext) : ext.test(name) ? [p] : []
  })
}

test('no apologetic copy anywhere (P8.1, DESIGN.md §6.13)', () => {
  const root = new URL('../../', import.meta.url).pathname
  const sources = [...files(join(root, 'frontend/src'), /\.(ts|tsx)$/), ...files(join(root, 'backend/app'), /\.py$/)]
  expect(sources.length).toBeGreaterThan(30)
  const hits = sources.filter((f) => /\bsorry\b|\bapologi[sz]e/i.test(readFileSync(f, 'utf8')))
  expect(hits).toEqual([])
})
