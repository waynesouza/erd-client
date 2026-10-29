import { defineConfig } from '@playwright/test';

// Runs against an already running stack (docker-compose locally, or the deployed one):
//   ERD_BASE_URL=https://erd-client.onrender.com npx playwright test
export default defineConfig({
  testDir: './tests',
  // Each test drives several browsers on one shared project; running tests in
  // parallel would only add noise to the timings they record.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['json', { outputFile: 'results/e2e-results.json' }]],
  use: {
    baseURL: process.env.ERD_BASE_URL ?? 'http://localhost:4200',
    // The locally installed Chrome, so no browser download is needed.
    channel: 'chrome',
    headless: true,
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure'
  }
});
