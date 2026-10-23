import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

// Documentation screenshots. Not part of the smoke run: only playwright.screenshots.config.ts matches this file
// (run it with scripts\dev\capture-screenshots.ps1). It only reads pages. It never opens the key-creation
// dialog, the invite dialog or a password field, and no URL it visits carries a token. The one chat turn
// (the calculator question) is the only thing that costs LLM tokens.
const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.SCREENSHOT_DIR ?? path.resolve(here, '../../../docs/screenshots');

async function shot(page: Page, name: string): Promise<void> {
  // Let loading skeletons and fonts settle, then capture the viewport.
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
  // Any email that is not a demo address (example.com) is painted over, so a real personal address that
  // happens to be on the page never reaches a committed image.
  const realEmails = page.locator('text=/[\\w.+-]+@(?!example\\.com)[\\w-]+\\.[\\w.]+/');
  await page.screenshot({ path: path.join(OUT, `${name}.png`), mask: [realEmails], maskColor: '#9ca3af' });
}

async function heading(page: Page, name: string): Promise<void> {
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
}

test('overview @desktop', async ({ page }) => {
  await page.goto('/');
  await heading(page, 'Overview');
  await expect(page.getByLabel('Server summary')).toBeVisible();
  await expect(page.getByText('Servers connected', { exact: true })).toBeVisible();
  await shot(page, 'overview');
});

test('servers @desktop', async ({ page }) => {
  await page.goto('/servers');
  await heading(page, 'Servers');
  const rows = page.getByRole('table', { name: 'MCP servers', exact: true }).locator('tbody > tr');
  await expect(rows.filter({ hasText: 'Connected' })).toHaveCount(3);
  await shot(page, 'servers');
});

test('server detail (woo) @desktop', async ({ page }) => {
  await page.goto('/servers');
  await heading(page, 'Servers');
  const row = page
    .getByRole('table', { name: 'MCP servers', exact: true })
    .locator('tbody > tr')
    .filter({ has: page.getByText('woo', { exact: true }) });
  await row.getByRole('link').click();
  await expect(page).toHaveURL(/\/servers\/[^/]+$/);
  await expect(page.locator('code', { hasText: /^woo__/ }).first()).toBeVisible();
  await shot(page, 'server-detail');
});

test('team (users list only) @desktop', async ({ page }) => {
  await page.goto('/team');
  await heading(page, 'Team');
  await expect(page.getByRole('table').first()).toBeVisible();
  await shot(page, 'team');
});

test('chat after one calculator question @desktop', async ({ page }) => {
  const status = await page.request.get('/api/chat/status');
  expect(status.ok(), `GET /api/chat/status answered ${status.status()}`).toBe(true);
  const { configured } = (await status.json()) as { configured: boolean };
  test.skip(!configured, 'The AI provider is not configured.');

  await page.goto('/chat');
  await heading(page, 'Chat');
  await page.getByLabel('Message', { exact: true }).fill('Use the calculator: what is 6 times 7?');
  await page.getByRole('button', { name: 'Send', exact: true }).click();

  const turns = page.getByRole('list', { name: 'Conversation' }).locator(':scope > li');
  const reply = turns.filter({ hasText: /^Assistant/ }).last();
  await expect(reply).toBeVisible({ timeout: 120_000 });
  const trace = reply.locator('details');
  await trace.locator('summary').click();
  const call = trace.locator('li').filter({ hasText: 'utils__calculate' });
  await expect(call.first()).toContainText('Succeeded');
  await expect(reply.locator('div.whitespace-pre-wrap')).toContainText('42');
  await expect(page.getByText(/^Today: [\d,]+ \/ [\d,]+ tokens$/)).toBeVisible();
  await shot(page, 'chat');
});

test('audit log @desktop', async ({ page }) => {
  await page.goto('/audit');
  await heading(page, 'Audit log');
  await expect(page.getByRole('table', { name: 'Audit log', exact: true }).locator('tbody > tr').first()).toBeVisible();
  await shot(page, 'audit');
});

test('servers on a phone @mobile', async ({ page }) => {
  await page.goto('/servers');
  await heading(page, 'Servers');
  const cards = page.getByRole('list', { name: 'MCP servers', exact: true }).locator(':scope > li');
  await expect(cards.filter({ hasText: 'Connected' })).toHaveCount(3);
  await shot(page, 'servers-mobile');
});
