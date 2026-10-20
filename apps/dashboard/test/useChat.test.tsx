import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useChat } from '../src/features/chat/useChat';
import { ApiError } from '../src/lib/api';
import { errorResponse, jsonResponse, mockFetch } from './helpers';

const ok = (reply: string) => jsonResponse(200, { reply, toolCalls: [], stoppedReason: 'final', provider: 'groq', model: 'm', usage: {} });

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
