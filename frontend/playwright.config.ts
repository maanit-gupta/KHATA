import { defineConfig, devices } from '@playwright/test'

/**
 * E2E runs the real frontend (Vite dev server) against a mocked backend: every request to
 * http://api.test (the API) and http://sb.test (Supabase Auth) is answered by e2e/mock.ts via
 * route interception. No live service is called.
 */
const PORT = 5199
export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: true,
  workers: 4,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    serviceWorkers: 'block',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        permissions: ['microphone'],
        launchOptions: {
          args: [
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            `--use-file-for-fake-audio-capture=${new URL('./e2e/fixtures/voice.wav', import.meta.url).pathname}`,
            '--autoplay-policy=no-user-gesture-required',
          ],
        },
      },
    },
  ],
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      VITE_API_URL: 'http://api.test',
      VITE_SUPABASE_URL: 'http://sb.test',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_e2e',
    },
  },
})
