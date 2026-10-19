import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuditEntry } from '../../src/audit/writer.js';
import type { AuthUser } from '../../src/auth/users.js';
import { ADMIN_EMAIL, ADMIN_PASSWORD, startHarness, type Harness } from '../helpers/harness.js';

interface AuditView {
  id: string;
  event: string;
  source: string;
  userId: string | null;
  userEmail: string | null;
  serverSlug: string | null;
  toolName: string | null;
  startedAt: string;
  durationMs: number;
  outcome: string;
  errorMessage: string | null;
}
interface Page {
  items: AuditView[];
  nextCursor: string | null;
}

describe('audit api', () => {
  let h: Harness;
  let admin: string;
  let alice: AuthUser;
  let bob: AuthUser;
  let aliceCookie: string;

  const entry = (o: Partial<AuditEntry>): AuditEntry => ({
    event: 'tool_call',
    source: 'mcp',
    userId: null,
    apiKeyId: null,
    serverId: null,
    serverSlug: 'woo',
    toolName: 'list_orders',
    startedAt: new Date('2026-10-19T10:00:00Z'),
    durationMs: 12,
    outcome: 'success',
    errorMessage: null,
    ...o,
  });

  beforeAll(async () => {
    h = await startHarness();
    admin = await h.loginAs(ADMIN_EMAIL, ADMIN_PASSWORD);
    alice = await h.createUser({ email: 'alice@example.com', role: 'member', password: 'alice-password-1' });
    bob = await h.createUser({ email: 'bob@example.com', role: 'member', password: 'bob-password-12' });
    aliceCookie = await h.loginAs('alice@example.com', 'alice-password-1');
    const rows: AuditEntry[] = [
      entry({ userId: alice.id, startedAt: new Date('2026-10-19T10:00:00Z') }),
      entry({ userId: alice.id, serverSlug: 'notes', toolName: 'create_note', outcome: 'timeout', errorMessage: "Upstream 'notes' did not respond within 20000ms", startedAt: new Date('2026-10-19T11:00:00Z') }),
      entry({ userId: alice.id, source: 'chat', startedAt: new Date('2026-10-19T12:00:00Z') }),
      entry({ userId: bob.id, outcome: 'timeout', startedAt: new Date('2026-10-19T13:00:00Z') }),
      entry({ userId: bob.id, serverSlug: 'notes', toolName: 'ping', outcome: 'error', errorMessage: 'boom', startedAt: new Date('2026-10-19T14:00:00Z') }),
      entry({ event: 'auth_rejected', userId: null, serverSlug: null, toolName: null, outcome: 'unauthorized', durationMs: 0, startedAt: new Date('2026-10-19T15:00:00Z') }),
    ];
    for (const r of rows) await h.deps.audit.record(r);
  });
  afterAll(async () => {
    await h.close();
  });

  const get = (query: string, cookie: string) => request(h.baseUrl).get(`/api/audit${query}`).set('Cookie', cookie);

  it('shows a member only their own rows, newest first', async () => {
    const res = await get('', aliceCookie);
    expect(res.status).toBe(200);
    const page = res.body as Page;
    expect(page.items).toHaveLength(3);
    expect(page.items.every((i) => i.userId === alice.id && i.userEmail === 'alice@example.com')).toBe(true);
    expect(page.items.map((i) => i.startedAt)).toEqual(['2026-10-19T12:00:00.000Z', '2026-10-19T11:00:00.000Z', '2026-10-19T10:00:00.000Z']);
    expect(page.nextCursor).toBeNull();
    expect((await get(`?userId=${alice.id}`, aliceCookie)).status).toBe(200);
  });

  it("forbids a member from asking for another user's rows", async () => {
    const res = await get(`?userId=${bob.id}`, aliceCookie);
    expect(res.status).toBe(403);
    expect((res.body as { error: { code: string } }).error.code).toBe('FORBIDDEN');
  });

  it('lets the admin see every row and filter by outcome, server, tool, user and time', async () => {
    const all = (await get('', admin)).body as Page;
    expect(all.items).toHaveLength(6);
    expect(all.items[0]).toMatchObject({ event: 'auth_rejected', userId: null, userEmail: null, outcome: 'unauthorized' });

    const timeouts = (await get('?outcome=timeout', admin)).body as Page;
    expect(timeouts.items.map((i) => i.userId).sort()).toEqual([alice.id, bob.id].sort());
    expect(timeouts.items.every((i) => i.outcome === 'timeout')).toBe(true);

    const notes = (await get('?serverSlug=notes', admin)).body as Page;
    expect(notes.items.map((i) => i.toolName)).toEqual(['ping', 'create_note']);

    expect(((await get('?serverSlug=notes&outcome=timeout', admin)).body as Page).items).toHaveLength(1);
    expect(((await get('?toolName=list_orders', admin)).body as Page).items).toHaveLength(3);
    expect(((await get(`?userId=${bob.id}`, admin)).body as Page).items).toHaveLength(2);
    const window = (await get('?from=2026-10-19T11:00:00Z&to=2026-10-19T13:00:00Z', admin)).body as Page;
    expect(window.items.map((i) => i.startedAt)).toEqual(['2026-10-19T12:00:00.000Z', '2026-10-19T11:00:00.000Z']);
  });

  it('walks every row exactly once with limit=2 and nextCursor', async () => {
    const ids: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res = await get(`?limit=2${cursor ? `&cursor=${cursor}` : ''}`, admin);
      expect(res.status).toBe(200);
      const page = res.body as Page;
      expect(page.items.length).toBeLessThanOrEqual(2);
      ids.push(...page.items.map((i) => i.id));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor !== null && pages < 10);
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(6);
    expect([...ids].sort((a, b) => Number(b) - Number(a))).toEqual(ids);
    expect(pages).toBe(3);
  });

  it('validates the query', async () => {
    for (const q of ['?limit=0', '?limit=101', '?limit=x', '?outcome=nope', '?cursor=abc', '?from=yesterday', '?userId=not-a-uuid', '?unknown=1']) {
      const res = await get(q, admin);
      expect(res.status, q).toBe(400);
      expect((res.body as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');
    }
    expect((await request(h.baseUrl).get('/api/audit')).status).toBe(401);
  });
});
