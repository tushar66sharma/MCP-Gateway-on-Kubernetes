import { ApiError } from '../api/errors.js';
import { mintInternalToken } from '../auth/internalToken.js';
import { FixedWindowLimiter } from '../auth/rateLimit.js';
import type { AuthUser } from '../auth/users.js';
import type { GatewayDeps } from '../server.js';
import { AgentLlmError, runAgentTurn, type AgentToolTrace, type AgentTurnResult } from './agent.js';
import { llmStatusOf } from './llm/registry.js';
import type { ChatMessage, Usage } from './llm/types.js';
import { connectLoopback, type McpToolClient } from './mcpLoopback.js';
import { REFUSAL_TEXT } from './systemPrompt.js';
import { checkTopic, type TopicCheckResult } from './topicCheck.js';
import { addUsage, budgetDay, getUsage, nextResetAt } from './usageRepo.js';

export interface ChatBudgetStatus {
  limit: number;
  used: number;
  remaining: number;
  /** ISO time of the next 00:00 in the store time zone. */
  resetsAt: string;
}

export type ChatStatus = ReturnType<typeof llmStatusOf> & { topicCheck: boolean; budget: ChatBudgetStatus | null };

export interface ChatService {
  status(user: AuthUser): Promise<ChatStatus>;
  runTurn(user: AuthUser, messages: ChatMessage[], clientSignal: AbortSignal): Promise<AgentTurnResult>;
}

const ZERO_USAGE: Usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
const toolNames = (traces: AgentToolTrace[]): string[] => traces.map((t) => t.name);

/**
 * One agent turn per call, as `user` (ADR-010): a loopback MCP client whose every request carries a
 * fresh internal token for this user, the per-user limits (one turn in flight, CHAT_RATE_LIMIT_PER_MIN
 * a minute), the daily token budget (checked before the turn), the on-topic check (ADR-020), the turn
 * timeout, and one `chat turn` log line. Message content is never logged.
 * `deps.llm` is read on each call (null → LLM_NOT_CONFIGURED before any MCP connection).
 */
export function createChatService(deps: GatewayDeps, mcpUrl: () => string): ChatService {
  const { config, logger } = deps;
  const limiter = new FixedWindowLimiter({ max: config.CHAT_RATE_LIMIT_PER_MIN, windowMs: 60_000, clock: deps.clock });
  const inFlight = new Set<string>();

  return {
    async status(user) {
      const now = deps.clock();
      const limit = config.CHAT_DAILY_TOKEN_BUDGET;
      let budget: ChatBudgetStatus | null = null;
      if (limit > 0) {
        const used = await getUsage(deps.db.db, user.id, budgetDay(now, config.STORE_TIMEZONE));
        budget = { limit, used, remaining: Math.max(0, limit - used), resetsAt: nextResetAt(now, config.STORE_TIMEZONE).toISOString() };
      }
      return { ...llmStatusOf(config), topicCheck: deps.topicLlm !== null, budget };
    },

    async runTurn(user, messages, clientSignal) {
      const llm = deps.llm;
      if (!llm) throw new ApiError(503, 'LLM_NOT_CONFIGURED', 'The chat assistant is not configured (no language model API key is set).');
      // Checked before the limiter, so a refused duplicate does not use up the user's turns.
      if (inFlight.has(user.id)) throw new ApiError(409, 'CONFLICT', 'A reply is already being generated');
      const limit = limiter.hit(`chat|${user.id}`);
      if (!limit.allowed) throw new ApiError(429, 'RATE_LIMITED', 'Too many chat messages; try again later', { retryAfterSec: limit.retryAfterSec });

      inFlight.add(user.id);
      const started = Date.now();
      const deadline = started + config.CHAT_TURN_TIMEOUT_MS;
      const signal = AbortSignal.any([clientSignal, AbortSignal.timeout(config.CHAT_TURN_TIMEOUT_MS)]);
      const mintToken = () => mintInternalToken(user.id, config.GATEWAY_INTERNAL_TOKEN_SECRET, undefined, deps.clock());
      let mcp: McpToolClient | undefined;
      // Tokens this turn has spent so far (topic check, then the main model), counted even when it fails.
      let spent = 0;
      let usedBefore = 0;
      let topicOutcome: TopicCheckResult['outcome'] = 'skipped';
      let topicCode: TopicCheckResult['code'];
      let topicMs = 0;
      let counted = false;
      const logTurn = (out: AgentTurnResult): void =>
        logger.info(
          {
            userId: user.id,
            steps: out.steps,
            tools: toolNames(out.toolCalls),
            stoppedReason: out.stoppedReason,
            durationMs: Date.now() - started,
            usage: out.usage,
            provider: out.provider,
            model: out.model,
            topicCheck: topicOutcome,
            topicCheckCode: topicCode,
            topicCheckMs: topicMs,
            budgetUsed: usedBefore + spent,
          },
          'chat turn',
        );
      const now = deps.clock();
      const day = budgetDay(now, config.STORE_TIMEZONE);
      try {
        // 1. Budget: a turn that starts under the limit may finish over it; the next one is refused.
        const budgetLimit = config.CHAT_DAILY_TOKEN_BUDGET;
        if (budgetLimit > 0) {
          usedBefore = await getUsage(deps.db.db, user.id, day);
          if (usedBefore >= budgetLimit) {
            const resetsAt = nextResetAt(now, config.STORE_TIMEZONE);
            throw new ApiError(429, 'CHAT_BUDGET_EXCEEDED', `Today's AI budget is used up. It resets at 00:00 (${config.STORE_TIMEZONE}).`, {
              limit: budgetLimit,
              used: usedBefore,
              resetsAt: resetsAt.toISOString(),
            });
          }
        }
        counted = true;

        // 2. Topic check (fails open: any error or odd reply lets the turn run under the scope rule).
        const topicLlm = deps.topicLlm;
        if (topicLlm) {
          const t0 = Date.now();
          const topic = await checkTopic(topicLlm, messages, signal, deadline);
          topicMs = Date.now() - t0;
          topicOutcome = topic.outcome;
          topicCode = topic.code;
          spent += topic.usage?.totalTokens ?? 0;
          if (topic.verdict === 'block') {
            const out: AgentTurnResult = {
              reply: REFUSAL_TEXT,
              toolCalls: [],
              stoppedReason: 'off_topic',
              usage: topic.usage ?? { ...ZERO_USAGE },
              provider: topicLlm.name,
              model: topicLlm.model,
              steps: 0,
            };
            logTurn(out);
            return out;
          }
        }

        mcp = await connectLoopback(mcpUrl(), mintToken, signal);
        const turn = await runAgentTurn({
          history: messages,
          llm,
          mcp,
          now: deps.clock(),
          storeTimeZone: config.STORE_TIMEZONE,
          userName: user.name,
          maxSteps: config.CHAT_MAX_STEPS,
          signal,
          deadline,
        });
        spent += turn.usage.totalTokens;
        // The turn ends as `timeout` when its signal aborts; if the browser disconnected, that is the reason.
        const out: AgentTurnResult = turn.stoppedReason === 'timeout' && clientSignal.aborted ? { ...turn, stoppedReason: 'client_closed' } : turn;
        logTurn(out);
        return out;
      } catch (err) {
        if (err instanceof ApiError) {
          logger.warn({ userId: user.id, code: err.code, durationMs: Date.now() - started }, 'chat turn');
        } else if (err instanceof AgentLlmError) {
          spent += err.usage.totalTokens;
          const e = err.llmError;
          // The llm layer does not log; these fields are its diagnostics (status and validated codes only).
          logger.warn(
            {
              userId: user.id,
              steps: err.steps,
              tools: toolNames(err.toolCalls),
              code: e.code,
              provider: e.provider,
              httpStatus: e.httpStatus,
              providerCode: e.providerCode,
              fallbackProvider: e.fallbackProvider,
              fallbackCode: e.fallbackCode,
              durationMs: Date.now() - started,
              usage: err.usage,
              topicCheck: topicOutcome,
              topicCheckCode: topicCode,
              budgetUsed: usedBefore + spent,
            },
            'chat turn',
          );
        } else {
          logger.warn({ userId: user.id, code: 'INTERNAL', error: err instanceof Error ? err.name : 'unknown', durationMs: Date.now() - started, topicCheck: topicOutcome, topicCheckCode: topicCode, budgetUsed: usedBefore + spent }, 'chat turn');
        }
        throw err;
      } finally {
        await mcp?.close();
        // The tokens are recorded last, whatever the turn ended in (a failure must not hide them).
        if (counted) {
          try {
            await addUsage(deps.db.db, user.id, day, spent);
          } catch (e) {
            logger.warn({ userId: user.id, error: e instanceof Error ? e.name : 'unknown' }, 'chat usage was not recorded');
          }
        }
        inFlight.delete(user.id);
      }
    },
  };
}
