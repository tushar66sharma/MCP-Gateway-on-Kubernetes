import { expect, test } from '@playwright/test';
import { tableRows } from './helpers';

const PROMPT = 'Use the calculator: what is 6 times 7?';

test('chat calls utils__calculate, answers 42 and the call is audited as Chat', async ({ page }) => {
  // A real LLM turn: allow for the provider's latency and one retry inside the gateway.
  test.setTimeout(150_000);

  const status = await page.request.get('/api/chat/status');
  expect(status.ok(), `GET /api/chat/status answered ${status.status()}`).toBe(true);
  const { configured, budget } = (await status.json()) as { configured: boolean; budget: unknown };
  test.skip(!configured, 'The AI provider is not configured (no llm-api-keys Secret): run scripts\\create-secrets.ps1 to enable the chat.');

  await page.goto('/chat');
  await expect(page.getByRole('heading', { level: 1, name: 'Chat' })).toBeVisible();
  await page.getByLabel('Message', { exact: true }).fill(PROMPT);
  await page.getByRole('button', { name: 'Send', exact: true }).click();

  const turns = page.getByRole('list', { name: 'Conversation' }).locator(':scope > li');
  const reply = turns.filter({ hasText: /^Assistant/ }).last();
  await expect(reply).toBeVisible({ timeout: 120_000 });

  const trace = reply.locator('details');
  await trace.locator('summary').click();
  const call = trace.locator('li').filter({ hasText: 'utils__calculate' });
  await expect(call.first()).toBeVisible();
  await expect(call.first()).toContainText('Succeeded');
  // The reply bubble itself (not the trace) must give the answer.
  await expect(reply.locator('div.whitespace-pre-wrap')).toContainText('42');

  // The usage line is shown while a daily budget is set (the default), and refreshes after the turn.
  if (budget) await expect(page.getByText(/^Today: [\d,]+ \/ [\d,]+ tokens$/)).toBeVisible();

  // The newest calculate call in the audit log is this one, marked as coming from the chat.
  await page.goto('/audit?serverSlug=utils&toolName=calculate');
  await expect(page.getByRole('heading', { level: 1, name: 'Audit log' })).toBeVisible();
  const newest = tableRows(page, 'Audit log', false).first();
  await expect(newest).toContainText('utils__calculate');
  await expect(newest.getByText('Chat', { exact: true })).toBeVisible();
  await expect(newest).toContainText('success');
});
