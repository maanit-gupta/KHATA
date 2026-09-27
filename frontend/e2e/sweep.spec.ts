/**
 * GOAL_2.0 P8, the missed-spec sweep: auth and session, mobile basics, loading and empty states,
 * correctness details, formatting and accessibility, each with its evidence.
 */
import { expect, test } from '@playwright/test'
import { lastCall, open } from './helpers'
import { MockApi, USER } from './mock'

test.describe('auth and session', () => {
  test('show password, clear wrong-password message, forgot password sends the link', async ({ page }) => {
    const m = new MockApi(); m.signedIn = false
    await open(page, m, '/login')
    const pw = page.getByLabel('Password *')
    await expect(pw).toHaveAttribute('type', 'password')
    await page.getByRole('button', { name: 'Show the password' }).click()
    await expect(pw).toHaveAttribute('type', 'text')
    await expect(page.getByRole('button', { name: 'Show the password' })).toHaveAttribute('aria-pressed', 'true')
    await page.getByLabel('Email *').fill('asha@example.com')
    await pw.fill('wrong-password')
    await page.getByRole('button', { name: 'Log in' }).click()
    await expect(page.getByRole('alert')).toHaveText('Wrong email or password. Check both and try again.')

    await page.getByRole('link', { name: 'Forgot your password?' }).click()
    await expect(page).toHaveURL(/\/forgot$/)
    const forgot = page.getByTestId('forgot-form')     // the login form is still leaving during the transition
    await forgot.getByLabel('Email *').fill('asha@example.com')
    await forgot.getByRole('button', { name: 'Send the link' }).click()
    await expect(page.getByTestId('forgot-form').getByRole('status')).toContainText('a link to set a new password is on its way')
    expect(m.authCalls).toContain('recover:POST')
  })

  test('reset page: the emailed link signs in, a new password is saved, on to the app', async ({ page }) => {
    const m = new MockApi().seed(); m.signedIn = false
    await m.install(page)
    const hash = `#access_token=e2e:${USER.id}&refresh_token=r&expires_in=3600&expires_at=${Math.floor(Date.now() / 1000) + 3600}&token_type=bearer&type=recovery`
    await page.goto(`/reset${hash}`)
    const form = page.getByTestId('reset-form')
    await form.getByLabel('New password *').fill('a-new-secret')
    await form.getByRole('button', { name: 'Save the new password' }).click()
    await expect(page).toHaveURL(/\/app$/)
    expect(m.authCalls).toContain('user:PUT')
  })

  test('reset page without a valid link says so and offers a new one', async ({ page }) => {
    const m = new MockApi(); m.signedIn = false
    await open(page, m, '/reset')
    await expect(page.getByRole('alert')).toHaveText('This link has expired or was already used. Ask for a new one.', { timeout: 8000 })
    await expect(page.getByRole('link', { name: 'Send a new link' })).toHaveAttribute('href', '/forgot')
  })

  test('a token about to expire is refreshed before the request goes out', async ({ page }) => {
    const m = new MockApi().seed()
    await page.addInitScript((id) => {
      const s = { access_token: `e2e:${id}`, refresh_token: 'e2e-refresh', token_type: 'bearer', expires_in: 30,
        expires_at: Math.floor(Date.now() / 1000) + 30, user: { id, aud: 'authenticated', role: 'authenticated', email: 'asha@example.com' } }
      window.localStorage.setItem('sb-sb-auth-token', JSON.stringify(s))
    }, USER.id)
    m.signedIn = false          // the init script above is the session
    await open(page, m, '/app/ledger')
    await expect(page.getByRole('table')).toBeVisible()
    expect(m.authCalls).toContain('token:refresh_token')
    expect(m.calls.every((c) => c.actor === USER.id)).toBe(true)
  })

  test('session ends mid-action: to login with a note, then back to the same page', async ({ page }) => {
    const m = new MockApi().seed()
    await open(page, m, '/app/ledger?type=expense')
    await expect(page.getByRole('table').or(page.getByText('No entries match these filters'))).toBeVisible()
    m.expireSession = true
    await page.getByRole('button', { name: 'Add by hand' }).click()
    const form = page.getByTestId('manual-add')
    await form.getByRole('button', { name: 'Expense' }).click()
    await form.getByLabel('Amount (₹) *').fill('40')
    await form.getByRole('button', { name: 'Save entry' }).click()
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByTestId('session-ended')).toHaveText('Your session ended. Log in again and you’ll be back where you were.')
    await page.getByLabel('Email *').fill('asha@example.com')
    await page.getByLabel('Password *').fill('secret-pass')
    await page.getByRole('button', { name: 'Log in' }).click()
    await expect(page).toHaveURL(/\/app\/ledger\?type=expense$/)
  })
})

test.describe('mobile basics', () => {
  test('every amount field opens the decimal keypad', async ({ page }) => {
    const m = new MockApi().seed()
    await open(page, m, '/app/ledger')
    await page.getByRole('button', { name: 'Add by hand' }).click()
    await expect(page.getByTestId('manual-add').getByLabel('Amount (₹) *')).toHaveAttribute('inputmode', 'decimal')
    await page.goto(`/app/entries/${m.entries[0].id}`)
    await expect(page.getByLabel('Amount (₹) *')).toHaveAttribute('inputmode', 'decimal')
  })

  test('the header respects the notch and the viewport allows it', async ({ page }) => {
    const m = new MockApi().seed()
    await open(page, m, '/app')
    await expect(page.locator('meta[name=viewport]')).toHaveAttribute('content', /viewport-fit=cover/)
    expect(await page.locator('header').first().evaluate((el) => el.getAttribute('style'))).toContain('safe-area-inset-top')
  })

  test('iOS audio: one element, unlocked by the first tap, reused for every clip', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __els: HTMLMediaElement[]; __srcs: string[] }
      w.__els = []; w.__srcs = []
      const play = HTMLMediaElement.prototype.play
      HTMLMediaElement.prototype.play = function () {
        if (!w.__els.includes(this)) w.__els.push(this)
        w.__srcs.push(this.src.slice(0, 20))
        return play.call(this).catch(() => undefined)
      }
    })
    const m = new MockApi().seed()
    await open(page, m, '/app/settings')
    await page.getByTestId('languages').getByRole('button', { name: /I speak in/ }).click()    // first tap: unlock
    await page.getByRole('button', { name: /^Voice/ }).click()
    await page.getByRole('radiogroup', { name: 'Voice' }).getByRole('radio').nth(1).click()   // a sample clip
    await expect.poll(() => page.evaluate(() => (window as unknown as { __srcs: string[] }).__srcs.length)).toBeGreaterThanOrEqual(2)
    const { els, srcs } = await page.evaluate(() => {
      const w = window as unknown as { __els: HTMLMediaElement[]; __srcs: string[] }
      return { els: w.__els.length, srcs: w.__srcs }
    })
    expect(srcs[0]).toMatch(/^data:audio\/mpeg/)          // the silent unlock, inside the tap
    expect(els).toBe(1)                                    // every clip after it plays on the same element
  })

  for (const width of [320, 390]) {
    test(`no sideways page scroll at ${width}px on any screen`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 })
      const m = new MockApi().seed()
      await m.install(page)
      const e = m.entries[0].id
      const p = m.parties[0].id
      for (const path of ['/', '/about', '/login', '/signup', '/forgot', '/app', '/app/ledger', '/app/dashboard', '/app/parties',
        `/app/parties/${p}`, '/app/review', `/app/entries/${e}`, '/app/scan', '/app/settings', '/app/report?period=week']) {
        await page.goto(path)
        await page.waitForLoadState('networkidle')
        const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
        expect(over, `${path} is ${over}px too wide at ${width}`).toBeLessThanOrEqual(0)
      }
    })
  }
})

test.describe('loading and empty states', () => {
  test('flat skeletons while lists, tables and charts load (no shimmer, no gradient)', async ({ page }) => {
    const m = new MockApi().seed()
    m.delayMs = { 'GET ledger': 1500, 'GET dashboard': 1500, 'GET parties': 1500, 'GET review': 1500, 'GET entries': 1500 }
    await open(page, m, '/app/ledger')
    await expect(page.getByTestId('skeleton').first()).toBeVisible()
    const bg = await page.getByTestId('skeleton').first().evaluate((el) => {
      const blocks = [...el.querySelectorAll('span')]
      return blocks.map((b) => getComputedStyle(b).backgroundImage).filter((x) => x !== 'none')
    })
    expect(bg).toEqual([])
    expect(await page.evaluate(() => document.getAnimations().filter((a) => (a as CSSAnimation).animationName?.includes('shimmer')).length)).toBe(0)
    await expect(page.getByRole('table')).toBeVisible()
    for (const path of ['/app/dashboard', '/app/parties', '/app/review']) {
      await page.goto(path)
      await expect(page.getByTestId('skeleton').first()).toBeVisible()
    }
  })

  test('an empty shop teaches the next step on every screen', async ({ page }) => {
    const m = new MockApi()
    await open(page, m, '/app')
    await expect(page.getByText('Hold ADD and say what happened,')).toBeVisible()
    await page.goto('/app/ledger')
    await expect(page.getByText('No entries match these filters. Clear them, or add one by hand.')).toBeVisible()
    await page.goto('/app/parties')
    await expect(page.getByText('No customers or suppliers yet. They appear when you add an entry.')).toBeVisible()
    await page.goto('/app/review')
    await expect(page.getByText('Nothing needs a look right now.')).toBeVisible()
    await page.goto('/app/dashboard')
    await expect(page.getByTestId('dashboard-empty')).toContainText('Hold ADD on Home and say one')
    await expect(page.getByTestId('activity-feed').or(page.getByText('Nothing yet. Every entry added'))).toBeVisible()
  })
})

test.describe('correctness details', () => {
  test('a party with entries keeps its kind, and says why', async ({ page }) => {
    const m = new MockApi().seed()
    const ramesh = m.parties.find((p) => p.display_name === 'Ramesh')!.id
    await open(page, m, `/app/parties/${ramesh}`)
    const edit = page.getByTestId('party-edit')
    await edit.getByRole('button', { name: 'Edit name or kind' }).click()
    await expect(edit.getByRole('button', { name: 'Supplier' })).toBeDisabled()
    await expect(edit.getByTestId('kind-locked')).toHaveText('It has entries, so it stays a customer: switching would change what every one of them means.')
  })

  test('a clashing name: "Already exists: Ramesh. Open it"', async ({ page }) => {
    const m = new MockApi().seed()
    const lakshmi = m.parties.find((p) => p.display_name === 'Lakshmi')!.id
    const ramesh = m.parties.find((p) => p.display_name === 'Ramesh')!.id
    m.failNext['PATCH parties'] = { status: 409, error: { code: 'name_taken', message: 'Ramesh already exists. Open it, or merge the two.', party_id: ramesh, party_name: 'Ramesh' } as never }
    await open(page, m, `/app/parties/${lakshmi}`)
    const edit = page.getByTestId('party-edit')
    await edit.getByRole('button', { name: 'Edit name or kind' }).click()
    await edit.getByLabel('Name *').fill('ramesh')
    await edit.getByRole('button', { name: 'Save' }).click()
    await expect(edit.getByTestId('name-taken')).toContainText('Already exists: Ramesh.')
    await edit.getByRole('link', { name: 'Open it' }).click()
    await expect(page).toHaveURL(new RegExp(`/app/parties/${ramesh}$`))
    expect(lastCall(m, 'PATCH', `/parties/${lakshmi}`)?.body).toEqual({ display_name: 'ramesh' })
  })

  test('voided entries are struck through in every list', async ({ page }) => {
    const m = new MockApi().seed()
    const lakshmi = m.parties.find((p) => p.display_name === 'Lakshmi')!.id
    const v = m.entry({ type: 'credit_given', amount_paise: 45600, party_id: lakshmi, status: 'voided' })
    await open(page, m, '/app/ledger?status=confirmed%2Cpending%2Cvoided')
    await expect(page.locator(`tbody tr[data-status="voided"]`)).toHaveClass(/line-through/)
    await page.goto('/app')                                  // recent entries list every status
    const amount = page.getByText('₹456', { exact: true }).first()
    await expect(amount).toBeVisible()
    expect(await amount.evaluate((el) => getComputedStyle(el).textDecorationLine)).toContain('line-through')
    await page.goto(`/app/entries/${v.id}`)
    await expect(page.getByTestId('voided-note')).toBeVisible()
  })
})
