import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import { STORAGE_STATE } from './e2e/helpers';

/**
 * End-to-end smoke against the deployed stack (not part of `npm test`).
 * Run it with `scripts\check-dashboard.ps1`, which loads the admin login into E2E_ADMIN_EMAIL /
 * E2E_ADMIN_PASSWORD for this process only. Nothing is recorded: no screenshots, traces or videos.
 */
const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: path.join(here, 'e2e'),
  outputDir: path.join(here, 'test-results'),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://app.localhost',
    screenshot: 'off',
    trace: 'off',
    video: 'off',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts$/ },
    {
      name: 'desktop',
      testMatch: /(smoke|chat)\.spec\.ts$/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, storageState: STORAGE_STATE },
    },
    {
      // The chat turn costs real LLM tokens (free-tier limits), so it runs once, on desktop.
      name: 'mobile',
      testMatch: /smoke\.spec\.ts$/,
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
