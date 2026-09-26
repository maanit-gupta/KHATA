/**
 * GOAL_2.0 P2: scan and upload that actually works, every path with mocked OCR.
 * success · partial · fail · cancel · retake · rotate · dark/small warning · HEIC · PDF ·
 * drag-and-drop · kind change on the form · 90 s "type it in" · double submit · mobile camera.
 */
import { expect, test, type Page } from '@playwright/test'
import { lastCall, makePng, open, shots } from './helpers'
import { MockApi, today } from './mock'

const BRIGHT = { name: 'bill.png', mimeType: 'image/png', buffer: makePng(900, 1300, [246, 244, 238]) }
const DARK_SMALL = { name: 'dim.png', mimeType: 'image/png', buffer: makePng(420, 380, [22, 22, 26]) }
const WIDE = { name: 'sideways.png', mimeType: 'image/png', buffer: makePng(1400, 800, [240, 240, 240]) }

async function startScan(page: Page, m: MockApi, kind: RegExp = /Supplier/, settle: string | null = 'Credit') {
  await open(page, m, '/app/scan')
  await page.getByRole('button', { name: kind }).click()
  if (settle) await page.getByRole('button', { name: settle }).click()
}

async function pick(page: Page, file: { name: string; mimeType: string; buffer: Buffer }) {
  await page.locator('input[type=file]').first().setInputFiles(file)
}

test.describe('scan', () => {
  test('success: preview → uploading / reading / checking → prefilled form → saved → another bill', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    const m = new MockApi().seed()
    m.nextReceipt = { status: 'done', vendor_name: 'Kaveri Provisions', bill_date: today(3), total_paise: 230800,
      ocr_text: 'KAVERI PROVISIONS\nGRAND TOTAL 2,308.00', total_check: 'ok' }
    await startScan(page, m)
    await expect(page.getByText('Drop a photo or PDF of the bill here')).toBeVisible()
    await shots(page, 'P2-scan', 'capture')
    await pick(page, BRIGHT)
    await expect(page.getByTestId('photo-preview').locator('img')).toBeVisible()
    await expect(page.getByTestId('photo-warning')).toHaveCount(0)
    await shots(page, 'P2-scan', 'preview')
    await page.getByRole('button', { name: 'Use this photo' }).click()
    const steps = page.getByTestId('scan-steps')
    await expect(steps).toBeVisible()
    await expect(steps.locator('li[data-state="pending"]')).toHaveText(/Reading the bill|Checking/)
    await expect(steps.locator('li[data-state="pending"]')).toHaveText('Checking', { timeout: 8_000 })
    await shots(page, 'P2-scan', 'reading')
    await expect(page.getByLabel('Vendor *')).toHaveValue('Kaveri Provisions', { timeout: 10_000 })
    await expect(page.getByLabel('Bill date')).toHaveValue(today(3))
    const total = page.getByLabel('Total (₹) *')
    await expect(total).toHaveValue('2308')
    await expect(total).toHaveAttribute('inputmode', 'decimal')
    await expect(page.locator('[data-hint]')).toHaveCount(0)              // every field filled
    await page.getByTestId('what-i-read').locator('summary').click()
    await expect(page.getByText('GRAND TOTAL 2,308.00')).toBeVisible()
    await page.getByTestId('bill-thumb').click()                             // enlarge beside the form
    await expect(page.getByTestId('bill-thumb')).toHaveAttribute('aria-expanded', 'true')
    await shots(page, 'P2-scan', 'review')
    await page.getByRole('button', { name: 'Save entry' }).click()
    await expect(page.getByTestId('saved-entry')).toContainText('₹2,308')
    await expect(page.getByTestId('saved-entry')).toContainText('Kaveri Provisions')
    await shots(page, 'P2-scan', 'saved')
    await page.getByRole('button', { name: 'Another bill' }).click()
    await expect(page.getByRole('heading', { name: /What kind\s*of bill\?/ })).toBeVisible()
    expect(m.uploads.filter((u) => u.path === '/receipts')).toHaveLength(1)
  })

  test('partial: missing fields say "Not found", the date defaults to today (IST), a doubtful total says "Check this"', async ({ page }) => {
    const m = new MockApi().seed()
    m.nextReceipt = { status: 'done', vendor_name: null, bill_date: null, total_paise: 99000, total_check: 'check', ocr_text: 'blurry' }
    await startScan(page, m, /Expense/, null)
    await pick(page, BRIGHT)
    await page.getByRole('button', { name: 'Use this photo' }).click()
    const form = page.getByTestId('bill-form')
    await expect(form).toBeVisible({ timeout: 10_000 })
    await expect(form.getByText('Not found, please type.')).toBeVisible()
    await expect(page.getByLabel('Bill date')).toHaveValue(today())
    await expect(form.getByText('Not found on the bill; today’s date is filled in.')).toBeVisible()
    await expect(form.locator('[data-hint="check"]')).toHaveText(/Check this/)
    await shots(page, 'P2-scan', 'partial')
  })

  test('fail: the bill could not be read → the error, empty total, type it and save', async ({ page }) => {
    const m = new MockApi().seed()
    m.nextReceipt = { status: 'failed', error: "Couldn't read the total. Type the values below.", vendor_name: 'Tulsi Mart', total_paise: null }
    await startScan(page, m)
    await pick(page, BRIGHT)
    await page.getByRole('button', { name: 'Use this photo' }).click()
    await expect(page.getByText("Couldn't read the total. Type the values below.")).toBeVisible({ timeout: 10_000 })
    await expect(page.getByLabel('Total (₹) *')).toHaveValue('')
    await expect(page.getByTestId('bill-form').getByText('Not found, please type.')).toBeVisible()
    await page.getByLabel('Total (₹) *').fill('1,440.50')
    await page.getByRole('button', { name: 'Save entry' }).click()
    await expect(page.getByTestId('saved-entry')).toContainText('₹1,440.50')
    expect(lastCall(m, 'POST', '/receipts/')?.body).toMatchObject({ vendor_name: 'Tulsi Mart', total_rupees: 1440.5 })
    await shots(page, 'P2-scan', 'fail-saved')
  })

  test('cancel while reading → back to the same photo; sending again uploads a new bill', async ({ page }) => {
    const m = new MockApi().seed()
    m.receiptStall = true
    await startScan(page, m)
    await pick(page, BRIGHT)
    await page.getByRole('button', { name: 'Use this photo' }).click()
    await expect(page.getByTestId('scan-steps')).toBeVisible()
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByRole('button', { name: 'Use this photo' })).toBeVisible()
    await expect(page.getByTestId('photo-preview').locator('img')).toBeVisible()
    m.receiptStall = false
    await page.getByRole('button', { name: 'Use this photo' }).click()
    await expect(page.getByTestId('bill-form')).toBeVisible({ timeout: 10_000 })
    expect(m.uploads.filter((u) => u.path === '/receipts')).toHaveLength(2)
  })

  test('retake: back to the camera, the new photo replaces the old one', async ({ page }) => {
    const m = new MockApi().seed()
    await startScan(page, m)
    await pick(page, DARK_SMALL)
    await expect(page.getByTestId('photo-warning')).toBeVisible()
    await page.getByRole('button', { name: 'Retake' }).click()
    await expect(page.getByRole('heading', { name: /Photograph\s*the bill\./ })).toBeVisible()
    await pick(page, BRIGHT)
    await expect(page.getByTestId('photo-warning')).toHaveCount(0)
    await page.getByRole('button', { name: 'Use this photo' }).click()
    await expect(page.getByTestId('bill-form')).toBeVisible({ timeout: 10_000 })
    const sent = m.uploads.filter((u) => u.path === '/receipts')
    expect(sent).toHaveLength(1)
    expect(sent[0].bytes.equals(BRIGHT.buffer)).toBe(true)     // the retaken photo, not the first one
  })

  test('dark or small photo: warned, but can still be sent', async ({ page }) => {
    const m = new MockApi().seed()
    await startScan(page, m)
    await pick(page, DARK_SMALL)
    await expect(page.getByTestId('photo-warning')).toHaveText('Photo too dark or small; retake for better reading.')
    await shots(page, 'P2-scan', 'warning')
    await page.getByRole('button', { name: 'Use this photo' }).click()
    await expect(page.getByTestId('bill-form')).toBeVisible({ timeout: 10_000 })
  })

  test('turn 90°: the photo sent is the turned one', async ({ page }) => {
    const m = new MockApi().seed()
    await startScan(page, m)
    await pick(page, WIDE)
    const img = page.getByTestId('photo-preview').locator('img')
    await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(1400)
    await page.getByRole('button', { name: 'Turn 90°' }).click()
    await expect.poll(() => img.evaluate((i: HTMLImageElement) => [i.naturalWidth, i.naturalHeight])).toEqual([800, 1400])
    await page.getByRole('button', { name: 'Use this photo' }).click()
    await expect(page.getByTestId('bill-form')).toBeVisible({ timeout: 10_000 })
    const sent = m.uploads.find((u) => u.path === '/receipts')!
    expect(sent.mime).toBe('image/jpeg')
    expect(sent.bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))).toBe(true)
  })

  test('HEIC this browser cannot open: a clear message, nothing sent', async ({ page }) => {
    const m = new MockApi().seed()
    await startScan(page, m)
    await pick(page, { name: 'IMG_0042.HEIC', mimeType: 'image/heic', buffer: Buffer.from('000000186674797068656963', 'hex') })
    await expect(page.getByRole('alert')).toContainText('This browser can’t open HEIC photos')
    expect(m.uploads).toHaveLength(0)
  })

  test('PDF: accepted as-is, shown by name', async ({ page }) => {
    const m = new MockApi().seed()
    await startScan(page, m)
    await pick(page, { name: 'invoice.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%fake one page\n') })
    await expect(page.getByTestId('photo-preview')).toContainText('PDF · invoice.pdf')
    await page.getByRole('button', { name: 'Use this photo' }).click()
    await expect(page.getByTestId('bill-form')).toBeVisible({ timeout: 10_000 })
    expect(m.uploads.find((u) => u.path === '/receipts')!.mime).toBe('application/pdf')
  })

  test('desktop: drag and drop a photo onto the drop zone', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    const m = new MockApi().seed()
    await startScan(page, m)
    const data = await page.evaluateHandle((b64) => {
      const bin = atob(b64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      const dt = new DataTransfer()
      dt.items.add(new File([bytes], 'dropped.png', { type: 'image/png' }))
      return dt
    }, BRIGHT.buffer.toString('base64'))
    await page.getByTestId('dropzone').dispatchEvent('drop', { dataTransfer: data })
    await expect(page.getByTestId('photo-preview').locator('img')).toBeVisible()
  })

  test('the bill kind and Paid/Credit can be changed on the review form', async ({ page }) => {
    const m = new MockApi().seed()
    await startScan(page, m)
    await pick(page, BRIGHT)
    await page.getByRole('button', { name: 'Use this photo' }).click()
    const form = page.getByTestId('bill-form')
    await expect(form).toBeVisible({ timeout: 10_000 })
    await form.getByRole('button', { name: 'Supplier' }).click()
    await form.getByRole('button', { name: 'Paid' }).click()
    await page.getByRole('button', { name: 'Save entry' }).click()
    await expect(page.getByTestId('saved-entry')).toContainText('Purchase paid')
    expect(lastCall(m, 'POST', '/receipts/')?.body).toMatchObject({ kind: 'supplier', settled: true })
  })

  test('after 90 s of reading: "Type it in instead" opens an empty form that saves', async ({ page }) => {
    const m = new MockApi().seed()
    m.receiptStall = true
    await page.clock.install()
    await startScan(page, m)
    await pick(page, BRIGHT)
    await page.getByRole('button', { name: 'Use this photo' }).click()
    await expect(page.getByTestId('scan-steps')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Type it in instead' })).toHaveCount(0)
    await page.clock.fastForward(91_000)
    await page.getByRole('button', { name: 'Type it in instead' }).click()
    await expect(page.getByText('Type the values from the bill.')).toBeVisible()
    await page.getByLabel('Vendor *').fill('Mehfil Traders')
    await page.getByLabel('Total (₹) *').fill('615')
    await page.getByRole('button', { name: 'Save entry' }).click()
    await expect(page.getByTestId('saved-entry')).toContainText('₹615')
  })

  test('double submit is impossible: two quick taps send one save', async ({ page }) => {
    const m = new MockApi().seed()
    m.delayMs['POST receipts'] = 600
    await startScan(page, m)
    await pick(page, BRIGHT)
    await page.getByRole('button', { name: 'Use this photo' }).click()
    await expect(page.getByTestId('bill-form')).toBeVisible({ timeout: 10_000 })
    await page.getByTestId('bill-form').evaluate((f: HTMLFormElement) => { f.requestSubmit(); f.requestSubmit() })
    await expect(page.getByTestId('saved-entry')).toBeVisible()
    expect(m.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/save'))).toHaveLength(1)
  })
})

test.describe('scan on a phone', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } })
  test('the camera opens directly, and the gallery is a separate link', async ({ page }) => {
    const m = new MockApi().seed()
    await startScan(page, m)
    const camera = page.locator('input[type=file][capture=environment]')
    await expect(camera).toHaveCount(1)
    await expect(camera).toHaveAttribute('accept', 'image/*')
    await expect(page.getByText('Take a photo')).toBeVisible()
    await expect(page.getByText('Upload from gallery')).toBeVisible()
    await page.screenshot({ path: new URL('../../artifacts/screens/P2-scan/capture-phone-390.png', import.meta.url).pathname, fullPage: true })
  })
})
