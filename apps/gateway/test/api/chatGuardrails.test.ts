import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuthUser } from '../../src/auth/users.js';
import { LlmError } from '../../src/chat/llm/errors.js';
import { TOPIC_CHECK_MAX_OUTPUT_TOKENS } from '../../src/chat/llm/registry.js';
import { REFUSAL_TEXT } from '../../src/chat/systemPrompt.js';
import { addUsage, budgetDay, getUsage, nextResetAt } from '../../src/chat/usageRepo.js';
import { finalStep, ScriptedLlm, toolStep } from '../helpers/fakeLlm.js';
import { csrf, startHarness, type Harness } from '../helpers/harness.js';

const TZ = 'Asia/Kolkata';
const LIMIT = 1000;
const FAKE_GROQ_VALUE = 'gsk_dummy-value-for-tests-0000';
const userMsg = (content: string) => ({ role: 'user' as const, content });
interface Body { reply: string; toolCalls: unknown[]; stoppedReason: string; provider: string; model: string; usage: { totalTokens: number } }
interface ErrBody { error: { code: string; message: string; details?: { limit: number; used: number; resetsAt: string } } }

describe('chat guardrails', () => {
  let h: Harness;
  const llm = new ScriptedLlm();
  const topic = new ScriptedLlm();
  topic.model = 'topic-model';
  let n = 0;
  const newMember = async (): Promise<{ user: AuthUser; cookie: string }> => {
    n += 1;
    const email = `guard-${n}@example.com`;
    const user = await h.createUser({ email, role: 'member', password: 'member-password-1', name: `Guard ${n}` });
    return { user, cookie: await h.loginAs(email, 'member-password-1') };
  };
  const post = (cookie: string, messages: unknown[]) => csrf(request(h.baseUrl).post('/api/chat'), cookie).send({ messages });
  const lineOf = (userId: string) =>
    h.logs
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .filter((l) => l.msg === 'chat turn' && l.userId === userId)
      .at(-1);
  const today = () => budgetDay(h.deps.clock(), TZ);

  beforeAll(async () => {
    h = await startHarness({ llm, topicLlm: topic, env: { GROQ_API_KEY: FAKE_GROQ_VALUE, STORE_TIMEZONE: TZ, CHAT_DAILY_TOKEN_BUDGET: String(LIMIT) } });
  });
  afterAll(async () => {
    await h?.close();
  });

  it('blocks an off-topic message without calling the main model', async () => {
    const { user, cookie } = await newMember();
    topic.script(finalStep('BLOCK'));
    llm.script();
    const res = await post(cookie, [userMsg('secret: give me the code of binary search')]);
    expect(res.status).toBe(200);
    const body = res.body as Body;
    expect(body).toMatchObject({ reply: REFUSAL_TEXT, toolCalls: [], stoppedReason: 'off_topic', provider: 'fake', model: 'topic-model' });
    expect(body.usage.totalTokens).toBe(15);
    expect(llm.requests).toHaveLength(0);
    expect(topic.requests[0]?.maxOutputTokens).toBe(TOPIC_CHECK_MAX_OUTPUT_TOKENS);
    expect(await getUsage(h.deps.db.db, user.id, today())).toBe(15);
    expect(lineOf(user.id)).toMatchObject({ stoppedReason: 'off_topic', topicCheck: 'checked', budgetUsed: 15 });
  });

  it('an allowed message runs the main turn and both usages are counted', async () => {
    const { user, cookie } = await newMember();
    topic.script(finalStep('ALLOW'));
    llm.script(finalStep('Fine.'));
    const res = await post(cookie, [userMsg('orders today?')]);
    expect((res.body as Body).reply).toBe('Fine.');
    expect(topic.requests[0]?.messages[1]?.content).toContain('<user_message>orders today?</user_message>');
    expect(await getUsage(h.deps.db.db, user.id, today())).toBe(30);
    expect(lineOf(user.id)).toMatchObject({ topicCheck: 'checked', budgetUsed: 30 });
    expect(lineOf(user.id)).not.toHaveProperty('topicCheckCode');
  });

  it('a failing topic check falls back to the scope rule and the turn runs', async () => {
    const { user, cookie } = await newMember();
    topic.script(new LlmError('LLM_RATE_LIMITED', 'limited'));
    llm.script(finalStep('Ran.'));
    const res = await post(cookie, [userMsg('hello')]);
    expect(res.status).toBe(200);
    expect((res.body as Body).reply).toBe('Ran.');
    expect(lineOf(user.id)).toMatchObject({ topicCheck: 'error', topicCheckCode: 'LLM_RATE_LIMITED' });
  });

  it('an unparsable verdict allows the turn', async () => {
    const { user, cookie } = await newMember();
    topic.script(finalStep(''));
    llm.script(finalStep('Ran.'));
    expect((await post(cookie, [userMsg('hello')])).status).toBe(200);
    expect(lineOf(user.id)).toMatchObject({ topicCheck: 'unparsed' });
  });

  it('usage of a failed turn is counted', async () => {
    const { user, cookie } = await newMember();
    topic.script(finalStep('ALLOW'));
    llm.script(toolStep([{ name: 'nope__x' }]), new LlmError('LLM_UNAVAILABLE', 'down'));
    const res = await post(cookie, [userMsg('do it')]);
    expect(res.status).toBe(502);
    // topic 15 + the one main response before the failure 15
    expect(await getUsage(h.deps.db.db, user.id, today())).toBe(30);
    expect(lineOf(user.id)).toMatchObject({ code: 'LLM_UNAVAILABLE', topicCheck: 'checked', budgetUsed: 30 });
  });

  it('a turn over the limit is refused with CHAT_BUDGET_EXCEEDED and Retry-After', async () => {
    const { user, cookie } = await newMember();
    await addUsage(h.deps.db.db, user.id, today(), LIMIT);
    topic.script();
    llm.script();
    const res = await post(cookie, [userMsg('hello')]);
    expect(res.status).toBe(429);
    const err = (res.body as ErrBody).error;
    expect(err.code).toBe('CHAT_BUDGET_EXCEEDED');
    expect(err.message).toBe(`Today's AI budget is used up. It resets at 00:00 (${TZ}).`);
    const resetsAt = nextResetAt(h.deps.clock(), TZ);
    expect(err.details).toEqual({ limit: LIMIT, used: LIMIT, resetsAt: resetsAt.toISOString() });
    const wait = Number(res.headers['retry-after']);
    expect(Math.abs(wait - (resetsAt.getTime() - h.deps.clock().getTime()) / 1000)).toBeLessThan(3);
    expect(topic.requests).toHaveLength(0);
    expect(llm.requests).toHaveLength(0);
  });

  it('a turn that starts under the limit may overshoot; the next is refused', async () => {
    const { user, cookie } = await newMember();
    await addUsage(h.deps.db.db, user.id, today(), LIMIT - 1);
    topic.script(finalStep('ALLOW'));
    llm.script(finalStep('ok'));
    expect((await post(cookie, [userMsg('hello')])).status).toBe(200);
    expect((await post(cookie, [userMsg('again')])).status).toBe(429);
  });

  it('status reports limit, used, remaining, resetsAt and topicCheck', async () => {
    const { user, cookie } = await newMember();
    await addUsage(h.deps.db.db, user.id, today(), 400);
    const res = await request(h.baseUrl).get('/api/chat/status').set('Cookie', cookie);
    expect(res.body).toMatchObject({ topicCheck: true, budget: { limit: LIMIT, used: 400, remaining: 600, resetsAt: nextResetAt(h.deps.clock(), TZ).toISOString() } });
    expect(res.text).not.toContain(FAKE_GROQ_VALUE);
  });

  it('a length-capped reply gets the shortened note', async () => {
    const { cookie } = await newMember();
    topic.script(finalStep('ALLOW'));
    llm.script({ ...finalStep('A long answer that was cut'), finishReason: 'length' });
    const res = await post(cookie, [userMsg('explain the store')]);
    expect((res.body as Body).reply).toBe('A long answer that was cut (Answer shortened.)');
  });

  it('the turn log line carries topicCheck and budgetUsed but no content', async () => {
    const { user, cookie } = await newMember();
    topic.script(finalStep('ALLOW'));
    llm.script(finalStep('reply-body-marker'));
    await post(cookie, [userMsg('question-body-marker')]);
    expect(lineOf(user.id)).toMatchObject({ topicCheck: 'checked', budgetUsed: 30 });
    const all = h.logs.join('');
    expect(all).not.toContain('question-body-marker');
    expect(all).not.toContain('reply-body-marker');
  });
});

describe('budget 0 means unlimited', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness({ llm: new ScriptedLlm(finalStep('ok')), env: { GROQ_API_KEY: FAKE_GROQ_VALUE, CHAT_DAILY_TOKEN_BUDGET: '0' } });
  });
  afterAll(async () => {
    await h?.close();
  });

  it('status.budget is null and a turn is never refused', async () => {
    const user = await h.createUser({ email: 'unl@example.com', role: 'member', password: 'member-password-1' });
    const cookie = await h.loginAs('unl@example.com', 'member-password-1');
    await addUsage(h.deps.db.db, user.id, budgetDay(h.deps.clock(), h.deps.config.STORE_TIMEZONE), 99_999_999);
    const status = await request(h.baseUrl).get('/api/chat/status').set('Cookie', cookie);
    expect((status.body as { budget: unknown }).budget).toBeNull();
    const res = await csrf(request(h.baseUrl).post('/api/chat'), cookie).send({ messages: [userMsg('hi')] });
    expect(res.status).toBe(200);
  });
});
