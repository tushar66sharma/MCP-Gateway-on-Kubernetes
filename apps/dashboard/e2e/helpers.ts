import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));

/** The signed-in admin session (git-ignored). Written by auth.setup.ts, read by the projects. */
export const STORAGE_STATE = path.join(here, '.auth', 'admin.json');

/** The admin login, from the environment only (scripts\check-dashboard.ps1 sets it). Never printed. */
export function adminCredentials(): { email: string; password: string } {
  const email = process.env.E2E_ADMIN_EMAIL;
  const password = process.env.E2E_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error('E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD are not set. Run scripts\\check-dashboard.ps1, which loads them from the cluster.');
  }
  return { email, password };
}

/** Signs in through the login form and waits for the overview. */
export async function signIn(page: Page): Promise<void> {
  const { email, password } = adminCredentials();
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
}

export function isMobile(testInfo: TestInfo): boolean {
  return testInfo.project.name === 'mobile';
}

/**
 * The rows of a ResponsiveTable: `<tr>`s of the table named by its caption from 640 px, and the
 * stacked cards (`<li>`s of the list with that name) below it.
 */
export function tableRows(page: Page, caption: string, mobile: boolean): Locator {
  return mobile
    ? page.getByRole('list', { name: caption, exact: true }).locator(':scope > li')
    : page.getByRole('table', { name: caption, exact: true }).locator('tbody > tr');
}

/** A short unique suffix for names this run creates. */
export function stamp(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}
