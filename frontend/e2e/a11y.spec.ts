import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { expectNoApologies, open } from './helpers'
import { MockApi } from './mock'

/** P8.2: axe (WCAG 2 A/AA) on every screen, 48px tap targets, labelled fields, visible square
 * focus rings, and a keyboard-only pass. */

function shop() {
  const m = new MockApi().seed()
  const ramesh = m.parties.find((p) => p.display_name === 'Ramesh')!.id
  m.entry({ type: 'credit_given', amount_paise: 600000, party_id: ramesh, status: 'pending', review_reason: 'amount above ₹5,000' })
  m.party('Rakesh', 'customer', true)
  return m
}

const SCREENS: [string, string, boolean][] = [
  ['landing', '/', false], ['login', '/login', false], ['signup', '/signup', false],
  ['ledger', '/app', true], ['parties', '/app/parties', true], ['party', '/app/parties/p-1', true],
  ['review', '/app/review', true], ['entry', '/app/entries/e-4', true], ['scan', '/app/scan', true],
  ['settings', '/app/settings', true], ['about', '/about', false],
]

async function settle(page: Page) {
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1500) // reveals and row draws finish
}

for (const [name, path, signedIn] of SCREENS) {
  test(`a11y: ${name}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' }) // final colours, no mid-animation states
    const m = shop()
    m.signedIn = signedIn
    await open(page, m, path)
    await settle(page)
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 })
      await page.waitForTimeout(300)
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
      const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
      expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`)).toEqual([])

      // Every visible control is at least 48×48 (DESIGN.md §4). Inline links inside running text
      // are exempt (WCAG 2.5.8 inline exception); none of ours are inline.
      const small = await page.$$eval('button, a[href], input:not([type=hidden]), [role=radio]', (els) =>
        els.filter((el) => {
          const r = el.getBoundingClientRect()
          const s = getComputedStyle(el)
          const hidden = r.width === 0 || s.visibility === 'hidden' || el.closest('[aria-hidden=true], .sr-only')
          if (hidden || (el as HTMLInputElement).type === 'file') return false
          return r.height < 47.5 || r.width < 47.5
        }).map((el) => `${el.tagName} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30)}" ${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`))
      expect(small).toEqual([])

      // Every field has an accessible name.
      const unlabelled = await page.$$eval('input:not([type=hidden]), select, textarea', (els) =>
        els.filter((el) => !(el as HTMLInputElement).labels?.length && !el.getAttribute('aria-label')).length)
      expect(unlabelled).toBe(0)
    }
    await expectNoApologies(page)
  })
}

test('focus ring is a visible 2px square outline, white on dark panels', async ({ page }) => {
  const m = shop()
  await open(page, m, '/app/entries/e-4')
  await settle(page)
  await page.keyboard.press('Tab')
  const ring = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement
    const s = getComputedStyle(el)
    return { style: s.outlineStyle, width: s.outlineWidth, radius: s.borderRadius }
  })
  expect(ring).toEqual({ style: 'solid', width: '2px', radius: '0px' })
  await page.getByLabel('Amount (₹) *').focus()
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Tab')
  const onDark = await page.evaluate(() => getComputedStyle(document.activeElement as HTMLElement).outlineColor)
  expect(onDark).toBe('rgb(253, 253, 253)')
})

test('keyboard only: hold to add with Space, confirm, open an entry, void with confirmation', async ({ page }) => {
  const m = shop()
  m.voiceQueue.push(() => ({ decision: 'auto', entry: m.out(m.entry({ type: 'cash_sale', amount_paise: 2000, source: 'voice', auto_saved: true })),
    suggestion: null, speech_text: '20 rupees cash sale, saved.', audio_b64: null, voice_note_id: 'vn-k', transcript_en: null }))
  await open(page, m, '/app')
  await settle(page)
  const add = page.getByRole('button', { name: 'Hold to add' })
  await add.focus()
  await page.keyboard.down('Space')
  await expect(page.getByRole('button', { name: 'Listening… release to send' })).toBeVisible()
  await page.waitForTimeout(1200)
  await page.keyboard.up('Space')
  await expect(page.getByRole('status').filter({ hasText: 'Saved · Cash sale · ₹20' })).toBeVisible()

  // Tab to the first recent entry row and open it with Enter.
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab')
    const label = await page.evaluate(() => document.activeElement?.textContent ?? '')
    if (/Cash sale/.test(label) && /₹450.50/.test(label)) break
  }
  const cashSale = m.entries.find((e) => e.type === 'cash_sale' && e.amount_paise === 45050)!
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(new RegExp(`/app/entries/${cashSale.id}$`))
  await page.getByRole('button', { name: 'Void entry' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: 'Keep it' })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(page.getByRole('button', { name: 'Yes, void it' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect.poll(() => cashSale.status).toBe('voided')
})

test('keyboard only: the MENU overlay opens, traps Escape, and navigates', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const m = shop()
  await open(page, m, '/app')
  await settle(page)
  await page.getByRole('button', { name: 'Menu' }).focus()
  await page.keyboard.press('Enter')
  const menu = page.getByRole('dialog', { name: 'Main' })
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('link', { name: 'Ledger' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await page.getByRole('button', { name: 'Menu' }).click()
  await menu.getByRole('link', { name: /Review/ }).click()
  await expect(page).toHaveURL(/\/app\/review$/)
})
