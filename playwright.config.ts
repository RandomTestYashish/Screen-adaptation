import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end coverage of the acceptance scenario in spec section 29.
 *
 * Both servers must already be running (`pnpm dev`), or set
 * PLAYWRIGHT_START_SERVERS=1 to have Playwright build and start them.
 */
const START = process.env['PLAYWRIGHT_START_SERVERS'] === '1';

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env['CI'] ? [['github'], ['list']] : [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1680, height: 1050 },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Some CI images ship a preinstalled Chromium whose build does not
        // match this Playwright version. Point at it instead of downloading.
        ...(process.env['PLAYWRIGHT_CHROMIUM_PATH']
          ? { launchOptions: { executablePath: process.env['PLAYWRIGHT_CHROMIUM_PATH'] } }
          : {}),
      },
    },
  ],
  ...(START
    ? {
        webServer: [
          {
            command: 'node apps/api/dist/main.js',
            url: 'http://localhost:4000/health',
            reuseExistingServer: true,
            timeout: 60_000,
          },
          {
            command: 'pnpm --filter @dae/web exec vite preview --port 5173 --strictPort',
            url: 'http://localhost:5173',
            reuseExistingServer: true,
            timeout: 60_000,
          },
        ],
      }
    : {}),
});
