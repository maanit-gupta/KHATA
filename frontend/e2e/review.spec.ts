import { expect, test } from '@playwright/test'
import { lastCall, open, shots } from './helpers'
import { MockApi, today } from './mock'

function shopWithReview() {
  const m = new MockApi().seed()
  const ramesh = m.parties.find((p) => p.display_name === 'Ramesh')!.id
  m.entry({ type: 'credit_given', amount_paise: 600000, party_id: ramesh, status: 'pending', review_reason: 'amount above ₹5,000', source: 'voice' })
  m.party('Rakesh', 'customer', true)
  m.entry({ type: 'credit_given', amount_paise: 25000, party_id: m.parties.at(-1)!.id })
  m.receipts['r-bad'] = { receipt_id: 'r-bad', status: 'failed', kind: 'expense', settled: null, vendor_name: null, bill_date: null,
    total_paise: null, retried_in_english: true, error: "Couldn't read the total. Type the values below.", reads: 0, ready: {} }
  return m
}

test('review queue: three groups, nav count, confirm a pending entry', async ({ page }) => {
  const m = shopWithReview()
  await open(page, m, '/app/review')
  await expect(page.getByRole('heading', { name: /Needs\s*a look\./ })).toBeVisible()
  await expect(page.getByTestId('review-entry')).toHaveCount(1)
  await expect(page.getByTestId('review-party')).toHaveCount(1)
  await expect(page.getByTestId('review-receipt')).toHaveCount(1)
  await expect(page.getByText('Amount above ₹5,000')).toBeVisible()
  await page.setViewportSize({ width: 1280, height: 900 })
  await expect(page.getByRole('link', { name: 'Review 3 to review' })).toBeVisible()
  await shots(page, 'P5.1-review', 'review-queue')

  await page.getByTestId('review-entry').getByRole('button', { name: 'Confirm' }).click()
  await expect(page.getByTestId('review-entry')).toHaveCount(0)
  expect(lastCall(m, 'POST', '/entries/')?.path).toMatch(/\/confirm$/)
  await expect(page.getByRole('link', { name: 'Review 2 to review' })).toBeVisible()
})

test('review queue: edit opens the entry', async ({ page }) => {
  const m = shopWithReview()
  await open(page, m, '/app/review')
  await page.getByTestId('review-entry').getByRole('button', { name: 'Edit' }).click()
  await expect(page).toHaveURL(/\/app\/entries\/e-\d+$/)
})

test('review queue: rename, keep and merge a new party', async ({ page }) => {
  const m = shopWithReview()
  await open(page, m, '/app/review')
  const row = page.getByTestId('review-party')
  await row.getByRole('button', { name: 'Rename' }).click()
  await row.getByLabel('New name').fill('Rakesh Kumar')
  await row.getByRole('button', { name: 'Save name' }).click()
  await expect(page.getByTestId('review-party')).toHaveCount(0)
  expect(lastCall(m, 'PATCH', '/parties/')?.body).toEqual({ display_name: 'Rakesh Kumar', needs_review: false })

  m.party('Mahesh', 'customer', true)
  await page.reload()
  await page.getByTestId('review-party').getByRole('button', { name: 'Keep as is' }).click()
  await expect(page.getByTestId('review-party')).toHaveCount(0)
  expect(lastCall(m, 'PATCH', '/parties/')?.body).toEqual({ needs_review: false })

  m.party('Rmesh', 'customer', true)
  await page.reload()
  const r2 = page.getByTestId('review-party')
  await r2.getByRole('button', { name: 'Merge into…' }).click()
  await expect(r2.getByText('Merge Rmesh into:')).toBeVisible()
  await expect(r2.getByRole('button', { name: 'Gupta Traders' })).toHaveCount(0) // only same kind
  await shots(page, 'P5.1-review', 'merge-picker')
  await r2.getByRole('button', { name: 'Ramesh', exact: true }).click()
  await expect(page.getByText('Merged Rmesh into Ramesh.')).toBeVisible()
  expect(lastCall(m, 'POST', '/parties/')?.path).toMatch(/\/merge$/)
})

test('review queue: failed bill → enter manually → saved and gone', async ({ page }) => {
  const m = shopWithReview()
  await open(page, m, '/app/review')
  await page.getByTestId('review-receipt').getByRole('button', { name: 'Enter manually' }).click()
  await expect(page).toHaveURL(/\/app\/scan\?receipt=r-bad$/)
  await expect(page.getByText("Couldn't read the total. Type the values below.")).toBeVisible()
  await page.getByLabel('Vendor').fill('Power bill')
  await page.getByLabel('Total (₹) *').fill('812')
  await page.getByLabel('Bill date').fill(today(1))
  await shots(page, 'P5.1-review', 'enter-manually')
  await page.getByRole('button', { name: 'Save entry' }).click()
  await expect(page.getByRole('heading', { name: /Bill\s*saved\./ })).toBeVisible()
  expect(lastCall(m, 'POST', '/receipts/r-bad/save')?.body).toMatchObject({ vendor_name: 'Power bill', total_rupees: 812 })
  await page.goto('/app/review')
  await expect(page.getByTestId('review-receipt')).toHaveCount(0)
})
