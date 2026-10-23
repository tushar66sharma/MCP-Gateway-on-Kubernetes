import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import { STORAGE_STATE } from './e2e/helpers';

/**
 * Screenshots for the documentation (docs/screenshots). A separate config on purpose: the default
 * playwright.config.ts (and so scripts\check-dashboard.ps1 and scripts\smoke-test.ps1) never matches
 * screenshots.spec.ts. Run it with scripts\dev\capture-screenshots.ps1, which loads the admin login
 * into E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD for this process only.
 */
const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: path.join(here, 'e2e'),
  outputDir: path.join(here, 'test-results'),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 150_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: { baseURL: process.env.E2E_BASE_URL ?? 'http://app.localhost', screenshot: 'off', trace: 'off', video: 'off' },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts$/ },
    {
      name: 'shots-desktop',
      testMatch: /screenshots\.spec\.ts$/,
      grep: /@desktop/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, storageState: STORAGE_STATE },
    },
    {
      name: 'shots-mobile',
      testMatch: /screenshots\.spec\.ts$/,
      grep: /@mobile/,
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        storageState: STORAGE_STATE,
      },
    },
  ],
});
