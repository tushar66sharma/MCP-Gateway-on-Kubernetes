import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Chat } from '../src/pages/Chat';
import { admin, errorResponse, jsonResponse, mockFetch, Providers } from './helpers';

const configured = { configured: true, provider: 'groq', model: 'openai/gpt-oss-120b', fallbackProvider: null };
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
    renderChat({ configured: false, provider: null, model: null, fallbackProvider: null });
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
});
