import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Chat } from '../src/pages/Chat';
import { admin, errorResponse, jsonResponse, mockFetch, Providers } from './helpers';

const configured = { configured: true, provider: 'groq', model: 'openai/gpt-oss-120b', fallbackProvider: null, topicCheck: true, budget: null };
const withBudget = (used: number, limit = 50000) => ({
  ...configured,
  budget: { limit, used, remaining: Math.max(0, limit - used), resetsAt: '2026-10-24T00:00:00.000Z' },
});
const final = (reply: string, stoppedReason = 'final') =>
  jsonResponse(200, { reply, toolCalls: [], stoppedReason, provider: 'groq', model: 'm', usage: {} });

function renderChat(status: unknown, chat?: () => Response | Promise<Response>) {
  const fetchFn = mockFetch({
    'GET /api/auth/me': () => jsonResponse(200, { user: admin }),
    'GET /api/chat/status': () => jsonResponse(200, status),
    ...(chat && { 'POST /api/chat': chat }),
  });
  render(
    <Providers>
      <Chat />
    </Providers>,
  );
  return fetchFn;
}

async function sendMessage(text: string) {
  const user = userEvent.setup(vi.isFakeTimers() ? { advanceTimers: vi.advanceTimersByTime.bind(vi) } : {});
  await user.type(await screen.findByLabelText('Message'), `${text}{Enter}`);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('Chat', () => {
  it('not configured shows setup state', async () => {
    renderChat({ configured: false, provider: null, model: null, fallbackProvider: null, topicCheck: false, budget: null });
    expect(await screen.findByText(/AI provider isn.t configured/i)).toBeInTheDocument();
    expect(screen.getByText(/Set up the AI chat/)).toBeInTheDocument();
    expect(screen.getByText(/create-secrets\.ps1/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Message')).toBeNull();
  });

  it('shows the provider and model', async () => {
    renderChat(configured);
    expect(await screen.findByText(/openai\/gpt-oss-120b/)).toBeInTheDocument();
  });

  it('reply is rendered as text not HTML', async () => {
    const payload = '<img src=x onerror=alert(1)>';
    renderChat(configured, () => final(payload));
    await sendMessage('hi');
    const reply = await screen.findByText(payload);
    expect(reply.querySelector('img')).toBeNull();
    expect(document.querySelector('img')).toBeNull();
  });

  it('shows executed tool calls on error', async () => {
    renderChat(configured, () =>
      errorResponse(429, 'LLM_RATE_LIMITED', 'limited', {
        headers: { 'Retry-After': '30' },
        details: {
          retryAfterSec: 30,
          toolCalls: [
            { name: 'woo__create_product', arguments: { name: 'Mug' }, outcome: 'success', durationMs: 120, resultPreview: 'created id 7' },
          ],
        },
      }),
    );
    await sendMessage('create a mug product');
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(/these actions already ran/i)).toBeInTheDocument();
    expect(within(alert).getByText('woo__create_product')).toBeInTheDocument();
    expect(within(alert).getByText(/created id 7/)).toBeInTheDocument();
    expect(within(alert).getByText('Succeeded')).toBeInTheDocument();
  });

  it('retry disabled for Retry-After seconds', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    renderChat(configured, () =>
      errorResponse(429, 'LLM_RATE_LIMITED', 'limited', { headers: { 'Retry-After': '3' }, details: { retryAfterSec: 3, toolCalls: [] } }),
    );
    await sendMessage('hello');
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(/try again in 3 seconds/i)).toBeInTheDocument();
    expect(within(alert).getByRole('button', { name: /retry/i })).toBeDisabled();
    act(() => {
      vi.advanceTimersByTime(3100);
    });
    await waitFor(() => expect(within(screen.getByRole('alert')).getByRole('button', { name: /retry/i })).toBeEnabled());
  });

  it('maps other error codes to friendly messages', async () => {
    renderChat(configured, () => errorResponse(502, 'LLM_AUTH_FAILED', 'raw provider text', { details: { toolCalls: [] } }));
    await sendMessage('hello');
    expect(await screen.findByText(/rejected the API key/i)).toBeInTheDocument();
    expect(screen.queryByText(/raw provider text/)).toBeNull();
  });

  it('notes a reply that stopped early', async () => {
    renderChat(configured, () => final('partial', 'max_steps'));
    await sendMessage('hello');
    expect(await screen.findByText('partial')).toBeInTheDocument();
    expect(screen.getByText(/step limit/i)).toBeInTheDocument();
  });

  it('shift+enter adds a newline instead of sending, and the counter shows the limit', async () => {
    const fetchFn = renderChat(configured, () => final('ok'));
    const box = await screen.findByLabelText('Message');
    expect(screen.getByText('0 / 4000')).toBeInTheDocument();
    fireEvent.change(box, { target: { value: 'line one' } });
    const user = userEvent.setup();
    await user.type(box, '{Shift>}{Enter}{/Shift}line two');
    expect(box).toHaveValue('line one\nline two');
    expect(fetchFn.mock.calls.some((c) => c[1]?.method === 'POST')).toBe(false);
  });

  it("shows today's usage from the status", async () => {
    renderChat(withBudget(1234));
    expect(await screen.findByText('Today: 1,234 / 50,000 tokens')).toBeInTheDocument();
  });

  it('hides the usage line when the budget is unlimited', async () => {
    renderChat(configured);
    await screen.findByLabelText('Message');
    expect(screen.queryByText(/^Today:/)).toBeNull();
  });

  it('an off_topic reply shows the scope note', async () => {
    renderChat(configured, () => final('I can only help with this store.', 'off_topic'));
    await sendMessage('write me a poem');
    expect(await screen.findByText('I can only help with this store.')).toBeInTheDocument();
    expect(screen.getByText("Outside this assistant's scope")).toBeInTheDocument();
    expect(screen.queryByText(/step limit/i)).toBeNull();
  });

  it('CHAT_BUDGET_EXCEEDED disables the composer until resetsAt', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], shouldAdvanceTime: true });
    const resetsAt = new Date(Date.now() + 60_000).toISOString();
    renderChat(configured, () =>
      errorResponse(429, 'CHAT_BUDGET_EXCEEDED', "Today's AI budget is used up. It resets at 00:00 (Asia/Kolkata).", {
        headers: { 'Retry-After': '60' },
        details: { limit: 50000, used: 50100, resetsAt },
      }),
    );
    await sendMessage('hello');
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(/AI budget is used up/)).toBeInTheDocument();
    expect(within(alert).getByText(/^Resets at /)).toBeInTheDocument();
    expect(within(alert).queryByRole('button', { name: /retry/i })).toBeNull();
    expect(screen.getByText('Daily AI budget used up')).toBeInTheDocument();
    expect(screen.getByLabelText('Message')).toBeDisabled();
    act(() => {
      vi.advanceTimersByTime(60_100);
    });
    await waitFor(() => expect(screen.getByLabelText('Message')).toBeEnabled());
    expect(screen.queryByText('Daily AI budget used up')).toBeNull();
  });

  it('status is refetched after a turn', async () => {
    const fetchFn = renderChat(configured, () => final('ok'));
    const statusCalls = () => fetchFn.mock.calls.filter((c) => c[0] === '/api/chat/status').length;
    await sendMessage('hello');
    await screen.findByText('ok');
    await waitFor(() => expect(statusCalls()).toBe(2));
  });

  it('a failed background status refetch keeps the conversation', async () => {
    let statusCalls = 0;
    const fetchFn = mockFetch({
      'GET /api/auth/me': () => jsonResponse(200, { user: admin }),
      'GET /api/chat/status': () => (++statusCalls === 1 ? jsonResponse(200, configured) : errorResponse(500, 'INTERNAL', 'boom')),
      'POST /api/chat': () => final('the conversation stays'),
    });
    render(
      <Providers>
        <Chat />
      </Providers>,
    );
    await sendMessage('hello');
    await screen.findByText('the conversation stays');
    await waitFor(() => expect(fetchFn.mock.calls.filter((c) => c[0] === '/api/chat/status').length).toBe(2));
    // Give the failed refetch time to settle into the error state.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(screen.queryByText(/Chat didn.t load/)).toBeNull();
    expect(screen.getByText('the conversation stays')).toBeInTheDocument();
    expect(screen.getByText('hello')).toBeInTheDocument();
    expect(screen.getByLabelText('Message')).toBeInTheDocument();
  });

  it('a status with nothing remaining locks the composer on first render', async () => {
    const resetsAt = new Date(Date.now() + 3_600_000).toISOString();
    renderChat({ ...configured, budget: { limit: 50000, used: 50000, remaining: 0, resetsAt } });
    expect(await screen.findByText('Daily AI budget used up')).toBeInTheDocument();
    expect(screen.getByText(/^Resets at /)).toBeInTheDocument();
    expect(screen.getByLabelText('Message')).toBeDisabled();
    expect(screen.getByLabelText('Message')).toHaveAccessibleDescription(/Daily AI budget used up/);
  });

  it('New conversation keeps the composer locked while the budget is used up', async () => {
    const resetsAt = new Date(Date.now() + 3_600_000).toISOString();
    renderChat({ ...configured, budget: { limit: 50000, used: 50100, remaining: 0, resetsAt } });
    await screen.findByText('Daily AI budget used up');
    await userEvent.setup().click(screen.getByRole('button', { name: /new conversation/i }));
    expect(screen.getByText('Daily AI budget used up')).toBeInTheDocument();
    expect(screen.getByLabelText('Message')).toBeDisabled();
  });

  it('a status lock lifts at resetsAt, refetches the status and announces it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], shouldAdvanceTime: true });
    const resetsAt = new Date(Date.now() + 60_000).toISOString();
    let calls = 0;
    renderChat({ ...configured, budget: { limit: 50000, used: 50000, remaining: 0, resetsAt } });
    const fetchFn = vi.mocked(fetch);
    await screen.findByText('Daily AI budget used up');
    expect(screen.getByLabelText('Message')).toBeDisabled();
    calls = fetchFn.mock.calls.filter((c) => c[0] === '/api/chat/status').length;
    act(() => {
      vi.advanceTimersByTime(60_100);
    });
    await waitFor(() => expect(screen.getByLabelText('Message')).toBeEnabled());
    expect(screen.queryByText('Daily AI budget used up')).toBeNull();
    expect(screen.getByText(/budget has reset/i)).toBeInTheDocument();
    await waitFor(() => expect(fetchFn.mock.calls.filter((c) => c[0] === '/api/chat/status').length).toBeGreaterThan(calls));
  });
});
