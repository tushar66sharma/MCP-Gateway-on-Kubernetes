import { ProtocolError, type CallToolResult } from '@modelcontextprotocol/client';
import type { Logger } from '@urumi/shared';
import type { AuditEntry, AuditWriter } from '../audit/writer.js';
import { assertSafeUpstreamUrl, type SsrfOptions } from '../security/ssrf.js';
import { UpstreamConnection, type UpstreamStatus, type UpstreamToolInfo } from './connection.js';
import { describeUpstreamError, isConnectionLevelError, isTimeoutError } from './errors.js';
import { parseGatewayToolName, toGatewayToolName } from './naming.js';
import { toUpstreamRecord, type UpstreamRepository, type UpstreamRow } from './repository.js';

/** `name` is the prefixed gateway name; `description` is '[<Server name>] ' + the upstream's description. */
export interface GatewayTool extends UpstreamToolInfo {
  serverId: string;
  serverSlug: string;
  upstreamName: string;
}

export interface CallContext {
  userId: string;
  apiKeyId: string | null;
  source: 'mcp' | 'chat';
}

export interface UpstreamState {
  status: UpstreamStatus;
  lastError: string | null;
  tools: GatewayTool[];
  skippedTools: string[];
  checkedAt: Date | null;
}

export interface UpstreamManagerOptions {
  repo: UpstreamRepository;
  audit: AuditWriter;
  logger: Logger;
  encKey: Buffer;
  ssrf: SsrfOptions;
  healthIntervalMs: number;
  healthTimeoutMs: number;
  callTimeoutMs: number;
  clock?: () => Date;
}

/** One held server. Replaced as a whole on upsert, so a check still running for the old row can tell it is stale. */
interface Entry {
  row: UpstreamRow;
  /** Held while the server is connected, or while a check is building it; null after any failure. */
  conn: UpstreamConnection | null;
  state: UpstreamState;
  /** Gateway tool name → tool, for the current `state.tools`. */
  index: Map<string, GatewayTool>;
  checking: Promise<UpstreamState> | null;
}

/**
 * The SDK's CallToolResult for gateway-made errors. Shared `toolError()` returns the narrower ToolResult,
 * which is not assignable to the SDK type, so the gateway builds its own here instead of casting.
 */
function gatewayError(text: string): CallToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

function firstText(r: CallToolResult): string | null {
  for (const c of r.content) if (c.type === 'text') return c.text;
  return null;
}

const emptyState = (status: UpstreamStatus): UpstreamState => ({ status, lastError: null, tools: [], skippedTools: [], checkedAt: null });

const byName = (a: GatewayTool, b: GatewayTool): number => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/**
 * Health-checked, cached catalog of upstream tools (ADR-014). `listTools()` never does I/O; a dead or
 * slow upstream only costs its own background check. Calls are never retried.
 */
export class UpstreamManager {
  private readonly entries = new Map<string, Entry>();
  private readonly clock: () => Date;
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(private readonly o: UpstreamManagerOptions) {
    this.clock = o.clock ?? (() => new Date());
  }

  /** Loads all rows, checks every one once (disabled rows are recorded as such), then starts the interval. */
  async start(): Promise<void> {
    this.stopped = false;
    for (const row of await this.o.repo.list()) this.entries.set(row.id, this.newEntry(row));
    await Promise.all([...this.entries.values()].map((e) => this.runCheck(e)));
    this.timer = setInterval(() => this.tick(), this.o.healthIntervalMs);
    this.timer.unref();
  }

  /** Clears the interval, closes every connection and waits for running checks to settle. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const all = [...this.entries.values()];
    await Promise.all(all.map((e) => this.dropConnection(e)));
    await Promise.allSettled(all.map((e) => e.checking));
  }

  /** (Re)builds the connection for one server and checks it now. */
  async upsert(row: UpstreamRow): Promise<void> {
    const old = this.entries.get(row.id);
    const entry = this.newEntry(row);
    this.entries.set(row.id, entry); // makes `old` stale before its connection is closed
    if (old) await this.dropConnection(old);
    await this.runCheck(entry);
  }

  async remove(id: string): Promise<void> {
    const old = this.entries.get(id);
    this.entries.delete(id);
    if (old) await this.dropConnection(old);
  }

  /** Runs a check now. If one is already running it is awaited first, so the result reflects the present. */
  async refresh(id: string): Promise<UpstreamState> {
    const entry = this.entries.get(id);
    if (!entry) return this.getState(id);
    while (entry.checking) await entry.checking;
    if (!this.isCurrent(entry)) return this.getState(id);
    return this.runCheck(entry);
  }

  /** Enabled and connected servers only, sorted by name. Never does I/O. */
  listTools(): GatewayTool[] {
    const out: GatewayTool[] = [];
    for (const e of this.entries.values()) {
      if (e.row.enabled && e.state.status === 'connected') out.push(...e.state.tools);
    }
    return out.sort(byName);
  }

  getState(id: string): UpstreamState {
    return this.entries.get(id)?.state ?? emptyState('unknown');
  }

  async callTool(gatewayName: string, args: Record<string, unknown>, ctx: CallContext, signal?: AbortSignal): Promise<CallToolResult> {
    const startedAt = this.clock();
    let server: { id: string; slug: string } | null = null;
    const finish = async (outcome: AuditEntry['outcome'], result: CallToolResult, errorMessage: string | null): Promise<CallToolResult> => {
      const durationMs = Math.max(0, this.clock().getTime() - startedAt.getTime());
      await this.o.audit.record({
        event: 'tool_call',
        source: ctx.source,
        userId: ctx.userId,
        apiKeyId: ctx.apiKeyId,
        serverId: server?.id ?? null,
        serverSlug: server?.slug ?? null,
        toolName: gatewayName,
        startedAt,
        durationMs,
        outcome,
        errorMessage,
      });
      // Never args, results, credentials or headers.
      this.o.logger.info({ tool: gatewayName, server: server?.slug ?? null, outcome, durationMs, userId: ctx.userId, source: ctx.source }, 'tool call');
      return result;
    };
    const fail = (outcome: AuditEntry['outcome'], text: string) => finish(outcome, gatewayError(text), text);

    const parsed = parseGatewayToolName(gatewayName);
    const entry = parsed ? this.findBySlug(parsed.slug) : undefined;
    if (!entry) return fail('denied', `Unknown tool: ${gatewayName}`);
    const { slug } = entry.row;
    server = { id: entry.row.id, slug };
    const conn = entry.conn;
    if (!entry.row.enabled || entry.state.status !== 'connected' || !conn) {
      return fail('denied', `Server '${slug}' is disabled or unreachable`);
    }
    const tool = entry.index.get(gatewayName);
    if (!tool) return fail('denied', `Unknown tool: ${gatewayName}`);

    const timeoutMs = this.o.callTimeoutMs;
    const deadline = AbortSignal.timeout(timeoutMs);
    try {
      const result = await conn.callTool(tool.upstreamName, args, {
        timeoutMs,
        signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
      });
      if (result.isError) return finish('error', result, firstText(result));
      return finish('success', result, null);
    } catch (err) {
      if (signal?.aborted && !deadline.aborted) return fail('error', `Call to '${gatewayName}' was cancelled`);
      if (deadline.aborted || isTimeoutError(err)) return fail('timeout', `Upstream '${slug}' did not respond within ${timeoutMs}ms`);
      if (err instanceof ProtocolError) return fail('error', `Upstream '${slug}' error: ${err.message}`);
      if (isConnectionLevelError(err)) {
        const reason = describeUpstreamError(err, timeoutMs);
        await this.markUnreachable(entry, conn, reason);
        return fail('error', `Upstream '${slug}' is unreachable: ${reason}`);
      }
      return fail('error', `Upstream '${slug}' error: ${describeUpstreamError(err, timeoutMs).replace(/^error: /, '')}`);
    }
  }

  private newEntry(row: UpstreamRow): Entry {
    return { row, conn: null, state: emptyState('unknown'), index: new Map(), checking: null };
  }

  private findBySlug(slug: string): Entry | undefined {
    for (const e of this.entries.values()) if (e.row.slug === slug) return e;
    return undefined;
  }

  private isCurrent(e: Entry): boolean {
    return !this.stopped && this.entries.get(e.row.id) === e;
  }

  private tick(): void {
    for (const e of this.entries.values()) {
      // Skips disabled servers and any server whose previous check is still running.
      if (e.row.enabled && !e.checking) void this.runCheck(e);
    }
  }

  private runCheck(e: Entry): Promise<UpstreamState> {
    const p = this.check(e).finally(() => {
      if (e.checking === p) e.checking = null;
    });
    e.checking = p;
    return p;
  }

  /** Never rejects: every failure becomes an `unreachable` state. */
  private async check(e: Entry): Promise<UpstreamState> {
    const { row } = e;
    const checkedAt = this.clock();
    if (!row.enabled) {
      await this.dropConnection(e);
      return this.commit(e, { status: 'disabled', lastError: null, tools: [], skippedTools: [], checkedAt });
    }
    const timeoutMs = this.o.healthTimeoutMs;
    let conn = e.conn;
    try {
      // Every check, not only on create: DNS answers change.
      await assertSafeUpstreamUrl(row.url, this.o.ssrf);
      if (!conn) {
        // A fresh client (and socket pool) after any failure: a restarted upstream never meets a stale client.
        conn = new UpstreamConnection(toUpstreamRecord(row, this.o.encKey), this.o.logger, this.o.ssrf);
        e.conn = conn;
        await conn.connect(timeoutMs);
      }
      const infos = await conn.listTools(timeoutMs);
      if (!this.isCurrent(e)) throw new Error('superseded');
      const tools: GatewayTool[] = [];
      const skippedTools: string[] = [];
      for (const t of infos) {
        const name = toGatewayToolName(row.slug, t.name);
        if (name === null) {
          skippedTools.push(t.name);
          continue;
        }
        const description = t.description ? `[${row.name}] ${t.description}` : `[${row.name}]`;
        tools.push({ ...t, name, description, serverId: row.id, serverSlug: row.slug, upstreamName: t.name });
      }
      tools.sort(byName);
      if (skippedTools.length > 0) this.o.logger.warn({ server: row.slug, skippedTools }, 'upstream tools skipped: invalid gateway tool name');
      return this.commit(e, { status: 'connected', lastError: null, tools, skippedTools, checkedAt });
    } catch (err) {
      if (conn) {
        if (e.conn === conn) e.conn = null;
        await conn.close();
      }
      return this.commit(e, { status: 'unreachable', lastError: describeUpstreamError(err, timeoutMs), tools: [], skippedTools: [], checkedAt });
    }
  }

  /** Connection-level failure during a call: drop the tools now, without waiting for the next tick. */
  private async markUnreachable(e: Entry, conn: UpstreamConnection, lastError: string): Promise<void> {
    // Only if nothing replaced that connection meanwhile (a newer check, an upsert, a stop).
    if (e.conn !== conn || !this.isCurrent(e)) return;
    e.conn = null;
    await conn.close();
    await this.commit(e, { status: 'unreachable', lastError, tools: [], skippedTools: [], checkedAt: this.clock() });
  }

  /** Publishes the state in memory, then mirrors it to the row. A stale entry's result is dropped. */
  private async commit(e: Entry, state: UpstreamState): Promise<UpstreamState> {
    if (!this.isCurrent(e)) return state;
    const previous = e.state;
    e.state = state;
    e.index = new Map(state.tools.map((t) => [t.name, t]));
    if (previous.status !== state.status || previous.lastError !== state.lastError) {
      this.o.logger.info({ server: e.row.slug, status: state.status, lastError: state.lastError }, 'upstream status');
    }
    try {
      await this.o.repo.updateHealth(e.row.id, {
        lastStatus: state.status,
        lastError: state.lastError,
        lastCheckedAt: state.checkedAt ?? this.clock(),
        toolCount: state.tools.length,
      });
    } catch (err) {
      this.o.logger.error({ server: e.row.slug, reason: err instanceof Error ? err.name : 'UnknownError' }, 'upstream health write failed');
    }
    return state;
  }

  private async dropConnection(e: Entry): Promise<void> {
    const conn = e.conn;
    e.conn = null;
    await conn?.close();
  }
}
