/**
 * GOAL_2.0 P1.2: stale-data hunt, in the browser.
 * (a) Two different recordings made back to back upload two different clips: the second upload
 *     holds the second clip only (not the first one again, and not both glued together).
 * (c) Each spoken result plays from a fresh object URL, and the previous one is revoked.
 */
import { expect, test, type Page } from '@playwright/test'
import { open } from './helpers'
import { MockApi, voiceResult } from './mock'

/** Replace the microphone with two known "fixture" clips: a 440 Hz tone, then an 880 Hz tone. */
async function fixtureMicrophone(page: Page) {
  await page.addInitScript(() => {
    const tones = [440, 880]
    let n = 0
    navigator.mediaDevices.getUserMedia = async () => {
      const ctx = new AudioContext()
      await ctx.resume()
      const osc = ctx.createOscillator()
      osc.frequency.value = tones[n++ % tones.length]
      const dest = ctx.createMediaStreamDestination()
      osc.connect(dest)
      osc.start()
      return dest.stream
    }
  })
}

/** Decode an uploaded clip in the page: its length in seconds and its pitch (zero crossings). */
async function analyse(page: Page, bytes: Buffer) {
  return page.evaluate(async (b64) => {
    const bin = atob(b64)
    const arr = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
    const buf = await new AudioContext().decodeAudioData(arr.buffer)
    const d = buf.getChannelData(0)
    // Skip the first/last 100 ms (encoder ramp), count sign changes in the middle.
    const from = Math.floor(buf.sampleRate * 0.1), to = d.length - from
    let crossings = 0
    for (let i = from + 1; i < to; i++) if ((d[i - 1] < 0) !== (d[i] < 0)) crossings++
    return { seconds: buf.duration, hz: crossings / 2 / ((to - from) / buf.sampleRate) }
  }, bytes.toString('base64'))
}

async function hold(page: Page, ms: number) {
  const btn = page.getByRole('button', { name: 'Hold to add' })
  const box = (await btn.boundingBox())!
  await page.mouse.move(box.x + 20, box.y + 20)
  await page.mouse.down()
  await expect(page.getByRole('button', { name: /Listening/ })).toBeVisible()
  await page.waitForTimeout(ms)
  await page.mouse.up()
}

test('P1.2a: back-to-back recordings upload two different clips, never the previous one', async ({ page }) => {
  await fixtureMicrophone(page)
  const m = new MockApi().seed()
  m.voiceQueue.push(
    () => voiceResult(m, { decision: 'auto', type: 'credit_given', rupees: 310, party: 'First Person', speech: 'First, saved.', transcript: 'first clip' }),
    () => voiceResult(m, { decision: 'auto', type: 'credit_given', rupees: 620, party: 'Second Person', speech: 'Second, saved.', transcript: 'second clip' }),
  )
  await open(page, m, '/app')
  await hold(page, 1600)
  await expect(page.getByTestId('result-card')).toContainText('First Person')
  await page.waitForTimeout(5200) // undo toast gone
  await hold(page, 1000)
  await expect(page.getByTestId('result-card')).toContainText('Second Person')

  const ups = m.uploads.filter((u) => u.path === '/voice/entry')
  expect(ups).toHaveLength(2)
  expect(ups[0].bytes.equals(ups[1].bytes)).toBe(false)
  const [a, b] = [await analyse(page, ups[0].bytes), await analyse(page, ups[1].bytes)]
  // The first upload is the 440 Hz clip, the second the 880 Hz clip.
  expect(a.hz).toBeGreaterThan(400); expect(a.hz).toBeLessThan(480)
  expect(b.hz).toBeGreaterThan(820); expect(b.hz).toBeLessThan(940)
  // The second upload is only as long as the second hold (not the first clip plus the second).
  expect(b.seconds).toBeLessThan(a.seconds)
  expect(b.seconds).toBeLessThan(1.6)
})

test('P1.2c: every read-back plays from a fresh object URL and the old one is revoked', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __made: string[]; __revoked: string[] }
    w.__made = []; w.__revoked = []
    const create = URL.createObjectURL.bind(URL)
    const revoke = URL.revokeObjectURL.bind(URL)
    URL.createObjectURL = (o: Blob | MediaSource) => { const u = create(o); if (o instanceof Blob && o.type.startsWith('audio/')) w.__made.push(u); return u }
    URL.revokeObjectURL = (u: string) => { w.__revoked.push(u); revoke(u) }
  })
  const m = new MockApi().seed()
  m.voiceQueue.push(
    () => voiceResult(m, { decision: 'auto', type: 'credit_given', rupees: 110, party: 'Person A', speech: 'A, saved.' }),
    () => voiceResult(m, { decision: 'auto', type: 'credit_given', rupees: 220, party: 'Person B', speech: 'B, saved.' }),
  )
  await open(page, m, '/app')
  await hold(page, 900)
  await expect(page.getByTestId('result-card')).toContainText('Person A')
  await hold(page, 900)
  await expect(page.getByTestId('result-card')).toContainText('Person B')
  const { made, revoked } = await page.evaluate(() => {
    const w = window as unknown as { __made: string[]; __revoked: string[] }
    return { made: w.__made, revoked: w.__revoked }
  })
  expect(made).toHaveLength(2)
  expect(made[0]).not.toBe(made[1])
  expect(revoked).toContain(made[0])       // the first read-back's URL is gone
  expect(revoked).not.toContain(made[1])   // the current one is still playable
  // ▶ replays the current result with a new URL, and revokes the one it replaces.
  await page.getByRole('button', { name: 'Play' }).first().click()
  const after = await page.evaluate(() => {
    const w = window as unknown as { __made: string[]; __revoked: string[] }
    return { made: [...w.__made], revoked: [...w.__revoked] }
  })
  expect(after.made).toHaveLength(3)
  expect(after.revoked).toContain(made[1])
})
