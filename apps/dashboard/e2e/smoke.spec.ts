import { expect, test, type Page } from '@playwright/test';
import { isMobile, signIn, stamp, tableRows } from './helpers';

const SERVERS = ['woo', 'notes', 'utils'] as const;

/** The number in one overview stat, or NaN while it is still a skeleton. */
async function statValue(page: Page, label: string): Promise<number> {
  const stat = page.getByLabel('Server summary').locator('div').filter({ has: page.getByText(label, { exact: true }) });
  const text = (await stat.locator('dd').textContent()) ?? '';
  return Number.parseInt(text.replace(/[^\d]/g, ''), 10);
}

test('overview shows at least 3 connected servers', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  await expect.poll(() => statValue(page, 'Servers connected')).toBeGreaterThanOrEqual(3);
});

test('servers lists woo, notes and utils as connected; utils has 4 tools', async ({ page }, testInfo) => {
  const mobile = isMobile(testInfo);
  await page.goto('/servers');
  await expect(page.getByRole('heading', { level: 1, name: 'Servers' })).toBeVisible();
  const rows = tableRows(page, 'MCP servers', mobile);
  for (const slug of SERVERS) {
    const row = rows.filter({ has: page.getByText(slug, { exact: true }) });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Connected');
  }

  await rows
    .filter({ has: page.getByText('utils', { exact: true }) })
    .getByRole('link')
    .click();
  await expect(page).toHaveURL(/\/servers\/[^/]+$/);
  await expect(page.getByText('utils', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: /tools?$/ })).toHaveText('4 tools');
  await expect(page.locator('code', { hasText: /^utils__/ })).toHaveCount(4);
});

test('keys: create, see the one-time key and snippet, confirm, close and revoke', async ({ page }, testInfo) => {
  const mobile = isMobile(testInfo);
  const name = `e2e ${stamp()}`;
  await page.goto('/keys');
  await expect(page.getByRole('heading', { level: 1, name: 'API keys' })).toBeVisible();

  await page.getByRole('button', { name: 'Create key' }).first().click();
  const create = page.getByRole('dialog', { name: 'Create API key' });
  await create.getByLabel('Key name').fill(name);
  await create.getByRole('button', { name: 'Create key' }).click();

  const shown = page.getByRole('dialog', { name: 'Your new API key' });
  await expect(shown).toBeVisible();
  // The key is compared inside the page and only a yes/no comes back, so a failure never prints it.
  const keyField = shown.getByRole('textbox', { name: 'API key' });
  await expect(keyField).toBeVisible();
  const keyLooksRight = await keyField.evaluate((el) => (el as HTMLInputElement).value.startsWith('ugw_'));
  expect(keyLooksRight, 'the API key field holds a value starting with ugw_').toBe(true);
  const snippet = shown.getByRole('region', { name: 'Claude Code command' });
  await expect(snippet).toBeVisible();
  const snippetLooksRight = await shown.evaluate((dialog) => {
    const key = dialog.querySelector<HTMLInputElement>('input[readonly]')?.value ?? '';
    const text = dialog.querySelector('pre')?.textContent ?? '';
    return key.length > 4 && text.startsWith('claude mcp add --transport http') && text.includes(`Bearer ${key}`);
  });
  expect(snippetLooksRight, 'the Claude Code snippet is a `claude mcp add` command carrying the new key').toBe(true);

  const close = shown.getByRole('button', { name: 'Close', exact: true });
  await expect(close).toBeDisabled();
  await shown.getByLabel('I have copied the key').check();
  await close.click();
  await expect(shown).toBeHidden();

  const row = tableRows(page, 'Your API keys', mobile).filter({ hasText: name });
  await expect(row).toContainText('Active');
  await row.getByRole('button', { name: `Revoke ${name}` }).click();
  const confirm = page.getByRole('alertdialog', { name: `Revoke ${name}?` });
  await confirm.getByRole('button', { name: 'Revoke key' }).click();
  await expect(confirm).toBeHidden();
  await expect(row).toContainText('Revoked');
  await expect(row.getByRole('button', { name: `Revoke ${name}` })).toHaveCount(0);
});

test('audit: rows are listed, and the server filter shows only utils calls', async ({ page }, testInfo) => {
  const mobile = isMobile(testInfo);
  await page.goto('/audit');
  await expect(page.getByRole('heading', { level: 1, name: 'Audit log' })).toBeVisible();
  const rows = tableRows(page, 'Audit log', mobile);
  await expect(rows.first()).toBeVisible();

  await page.getByLabel('Server', { exact: true }).selectOption('utils');
  await expect(page).toHaveURL(/[?&]serverSlug=utils(&|$)/);
  // Every row names its tool as `<server>__<tool>`, in both the table and the card layout.
  await expect
    .poll(async () => {
      const texts = await rows.allTextContents();
      return texts.length > 0 && texts.every((t) => t.includes('utils__'));
    })
    .toBe(true);
  if (!mobile) {
    const serverCells = page.getByRole('table', { name: 'Audit log' }).locator('tbody > tr > td:nth-child(5)');
    for (const cell of await serverCells.allTextContents()) expect(cell.trim()).toBe('utils');
  }
});

test('team: invite, see the link dialog, close it and cancel the invite', async ({ page }) => {
  const email = `e2e+${stamp()}@example.com`;
  await page.goto('/team');
  await expect(page.getByRole('heading', { level: 1, name: 'Team' })).toBeVisible();

  await page.getByRole('button', { name: 'Invite member' }).first().click();
  const invite = page.getByRole('dialog', { name: 'Invite a member' });
  await invite.getByLabel('Email').fill(email);
  await invite.getByRole('button', { name: 'Create invite' }).click();

  const created = page.getByRole('dialog', { name: 'Invite created' });
  await expect(created).toBeVisible();
  await expect(created.getByRole('textbox', { name: 'Invite link' })).toBeVisible();
  await created.getByRole('button', { name: 'Done' }).click();
  await expect(created).toBeHidden();

  const cancel = page.getByRole('button', { name: `Cancel invite for ${email}` });
  await cancel.click();
  const confirm = page.getByRole('alertdialog', { name: 'Cancel this invite?' });
  await confirm.getByRole('button', { name: 'Cancel invite' }).click();
  await expect(confirm).toBeHidden();
  await expect(cancel).toHaveCount(0);
});

test('mobile: the drawer navigates, and the servers table renders as cards', async ({ page }, testInfo) => {
  test.skip(!isMobile(testInfo), 'The navigation drawer and card layout exist only on narrow screens.');
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();

  const open = page.getByRole('button', { name: 'Open navigation' });
  await open.click();
  const drawer = page.getByRole('dialog', { name: 'Navigation' });
  await expect(drawer).toBeVisible();
  await drawer.getByRole('link', { name: 'Servers' }).click();
  await expect(drawer).toBeHidden();
  await expect(page).toHaveURL(/\/servers$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Servers' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'MCP servers' })).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0);

  await open.click();
  await expect(drawer).toBeVisible();
  await drawer.getByRole('link', { name: 'Audit log' }).click();
  await expect(drawer).toBeHidden();
  await expect(page.getByRole('heading', { level: 1, name: 'Audit log' })).toBeVisible();
});

test.describe('log out', () => {
  // Its own session: logging out ends the session, and the shared one is still needed by the other project.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('log out lands on /login', async ({ page }) => {
    await signIn(page);
    await page.getByRole('button', { name: /^Account:/ }).click();
    await page.getByRole('menuitem', { name: 'Log out' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
  });
});
