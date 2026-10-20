import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useChat } from '../src/features/chat/useChat';
import { ApiError } from '../src/lib/api';
import { errorResponse, jsonResponse, mockFetch } from './helpers';

const ok = (reply: string) => jsonResponse(200, { reply, toolCalls: [], stoppedReason: 'final', provider: 'groq', model: 'm', usage: {} });

type Wire = Array<{ role: string; content: string }>;
const sentMessages = (fetchFn: ReturnType<typeof mockFetch>, call: number): Wire =>
  (JSON.parse(String(fetchFn.mock.calls[call]?.[1]?.body)) as { messages: Wire }).messages;
const hasConsecutiveRoles = (msgs: Wire) => msgs.some((m, i) => i > 0 && msgs[i - 1]?.role === m.role);

const partialRun = () =>
  errorResponse(429, 'LLM_RATE_LIMITED', 'limited', {
    headers: { 'Retry-After': '0' },
    details: {
      toolCalls: [
        { name: 'woo__create_product', arguments: { name: 'Secret Mug' }, outcome: 'success', durationMs: 120, resultPreview: '{"id":77,"name":"Secret Mug"}' },
        { name: 'notes__create_note', arguments: {}, outcome: 'error', durationMs: 5, resultPreview: 'boom' },
      ],
    },
  });

describe('useChat', () => {
  it('sends only role and content of last 20', async () => {
    const fetchFn = mockFetch({ 'POST /api/chat': () => ok('answer') });
    const { result } = renderHook(() => useChat());
    for (let i = 0; i < 12; i++) {
      await act(async () => {
        await result.current.send(`question ${i}`);
      });
    }
    expect(result.current.messages).toHaveLength(24);
    const last = fetchFn.mock.calls.at(-1);
    const body = JSON.parse(String(last?.[1]?.body)) as { messages: Array<Record<string, unknown>> };
    expect(body.messages).toHaveLength(20);
    for (const m of body.messages) expect(Object.keys(m).sort()).toEqual(['content', 'role']);
    expect(body.messages.at(-1)).toEqual({ role: 'user', content: 'question 11' });
  });

  it('keeps user text on error', async () => {
    mockFetch({ 'POST /api/chat': () => errorResponse(502, 'LLM_UNAVAILABLE', 'down') });
    const { result } = renderHook(() => useChat());
    await act(async () => {
      await result.current.send('please keep me');
    });
    expect(result.current.pending).toBe(false);
    expect(result.current.error).toBeInstanceOf(ApiError);
    expect((result.current.error as ApiError).code).toBe('LLM_UNAVAILABLE');
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]).toMatchObject({ role: 'user', content: 'please keep me' });
  });

  it('retry resends the kept message without duplicating it', async () => {
    let calls = 0;
    mockFetch({ 'POST /api/chat': () => (++calls === 1 ? errorResponse(502, 'LLM_UNAVAILABLE', 'down') : ok('fine')) });
    const { result } = renderHook(() => useChat());
    await act(async () => {
      await result.current.send('hello');
    });
    await act(async () => {
      await result.current.retry();
    });
    expect(result.current.error).toBeNull();
    expect(result.current.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(result.current.messages[1]?.content).toBe('fine');
  });

  it('never sends an empty assistant reply back', async () => {
    let calls = 0;
    const fetchFn = mockFetch({ 'POST /api/chat': () => ok(++calls === 1 ? '' : 'second answer') });
    const { result } = renderHook(() => useChat());
    await act(async () => {
      await result.current.send('first');
    });
    await act(async () => {
      await result.current.send('second');
    });
    expect(result.current.error).toBeNull();
    const wire = sentMessages(fetchFn, 1);
    expect(wire.every((m) => m.content.length > 0)).toBe(true);
    expect(hasConsecutiveRoles(wire)).toBe(false);
    expect(wire[0]).toEqual({ role: 'user', content: 'first' });
    expect(wire.at(-1)).toEqual({ role: 'user', content: 'second' });
  });

  it('after an error with tool calls, the next message carries a note of what already ran', async () => {
    let calls = 0;
    const fetchFn = mockFetch({ 'POST /api/chat': () => (++calls === 1 ? partialRun() : ok('It was created.')) });
    const { result } = renderHook(() => useChat());
    await act(async () => {
      await result.current.send('Create a mug product');
    });
    expect(result.current.error).toBeInstanceOf(ApiError);
    await act(async () => {
      await result.current.send('did it work?');
    });
    const wire = sentMessages(fetchFn, 1);
    expect(hasConsecutiveRoles(wire)).toBe(false);
    expect(wire.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(wire[0]).toEqual({ role: 'user', content: 'Create a mug product' });
    expect(wire[1]?.content).toBe(
      '(The previous request failed after these actions already ran: woo__create_product succeeded, notes__create_note failed. Do not repeat them unless asked.)',
    );
    // Tool names and outcomes only: never arguments or results.
    expect(wire[1]?.content).not.toContain('Secret Mug');
    expect(wire[1]?.content).not.toContain('boom');
    expect(wire[2]).toEqual({ role: 'user', content: 'did it work?' });
    expect(result.current.messages.map((m) => m.role)).toEqual(['user', 'user', 'assistant']);
  });

  it('retry after a partial run sends the note and does not duplicate the user turn', async () => {
    let calls = 0;
    const fetchFn = mockFetch({ 'POST /api/chat': () => (++calls === 1 ? partialRun() : ok('Done, the mug exists.')) });
    const { result } = renderHook(() => useChat());
    await act(async () => {
      await result.current.send('Create a mug product');
    });
    await act(async () => {
      await result.current.retry();
    });
    expect(result.current.error).toBeNull();
    const wire = sentMessages(fetchFn, 1);
    expect(hasConsecutiveRoles(wire)).toBe(false);
    expect(wire.filter((m) => m.content === 'Create a mug product')).toHaveLength(1);
    expect(wire[1]?.role).toBe('assistant');
    expect(wire[1]?.content).toContain('woo__create_product succeeded');
    expect(wire.at(-1)).toEqual({ role: 'user', content: 'Continue from where you stopped.' });
    expect(result.current.messages.map((m) => [m.role, m.content])).toEqual([
      ['user', 'Create a mug product'],
      ['assistant', 'Done, the mug exists.'],
    ]);
    // The note stays in later requests, so the model keeps knowing what already ran.
    await act(async () => {
      await result.current.send('thanks');
    });
    const later = sentMessages(fetchFn, 2);
    expect(hasConsecutiveRoles(later)).toBe(false);
    expect(later.filter((m) => m.content === 'Create a mug product')).toHaveLength(1);
    expect(later.some((m) => m.content.includes('woo__create_product succeeded'))).toBe(true);
  });

  it('an unanswered turn without tool calls is followed by a no-reply note', async () => {
    let calls = 0;
    const fetchFn = mockFetch({ 'POST /api/chat': () => (++calls === 1 ? errorResponse(502, 'LLM_UNAVAILABLE', 'down') : ok('hello')) });
    const { result } = renderHook(() => useChat());
    await act(async () => {
      await result.current.send('first try');
    });
    await act(async () => {
      await result.current.send('second try');
    });
    expect(sentMessages(fetchFn, 1)).toEqual([
      { role: 'user', content: 'first try' },
      { role: 'assistant', content: '(no reply)' },
      { role: 'user', content: 'second try' },
    ]);
  });

  it('reset clears the conversation', async () => {
    mockFetch({ 'POST /api/chat': () => ok('x') });
    const { result } = renderHook(() => useChat());
    await act(async () => {
      await result.current.send('hi');
    });
    act(() => result.current.reset());
    expect(result.current.messages).toEqual([]);
    expect(result.current.error).toBeNull();
  });
});
