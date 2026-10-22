import { expect, test } from '@playwright/test';

// Phone width only (the mobile project). Opens /chat and never sends a message, so no LLM tokens are spent.
test('chat page fits a phone screen without sending anything', async ({ page }) => {
  const chatPosts: string[] = [];
  page.on('request', (req) => {
    if (req.method() === 'POST' && new URL(req.url()).pathname === '/api/chat') chatPosts.push(req.url());
  });

  const status = await page.request.get('/api/chat/status');
  expect(status.ok(), `GET /api/chat/status answered ${status.status()}`).toBe(true);
  const { configured } = (await status.json()) as { configured: boolean };

  await page.goto('/chat');
  await expect(page.getByRole('heading', { level: 1, name: 'Chat' })).toBeVisible();

  if (configured) {
    await expect(page.getByLabel('Message', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible();
    await expect(page.getByText('Try asking')).toBeVisible();
    await expect(page.getByRole('button', { name: 'What orders came in today?' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'New conversation' })).toBeVisible();
  } else {
    await expect(page.getByText('The AI provider isn’t configured')).toBeVisible();
  }

  const overflow = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
  expect(overflow.scrollWidth, `page is ${overflow.scrollWidth}px wide in a ${overflow.innerWidth}px viewport`).toBeLessThanOrEqual(overflow.innerWidth);
  expect(chatPosts).toEqual([]);
});
