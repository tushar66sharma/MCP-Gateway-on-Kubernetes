import { ApiError } from '../api/errors.js';
import { mintInternalToken } from '../auth/internalToken.js';
import { FixedWindowLimiter } from '../auth/rateLimit.js';
import type { AuthUser } from '../auth/users.js';
import type { GatewayDeps } from '../server.js';
import { AgentLlmError, runAgentTurn, type AgentToolTrace, type AgentTurnResult } from './agent.js';
import { llmStatusOf } from './llm/registry.js';
import type { ChatMessage } from './llm/types.js';
import { connectLoopback, type McpToolClient } from './mcpLoopback.js';

export interface ChatService {
  status(): ReturnType<typeof llmStatusOf>;
  runTurn(user: AuthUser, messages: ChatMessage[], clientSignal: AbortSignal): Promise<AgentTurnResult>;
}

const toolNames = (traces: AgentToolTrace[]): string[] => traces.map((t) => t.name);

/**
 * One agent turn per call, as `user` (ADR-010): a loopback MCP client whose every request carries a
 * fresh internal token for this user, the per-user limits (one turn in flight, CHAT_RATE_LIMIT_PER_MIN
 * a minute), the turn timeout, and one `chat turn` log line. Message content is never logged.
 * `deps.llm` is read on each call (null → LLM_NOT_CONFIGURED before any MCP connection).
 */
export function createChatService(deps: GatewayDeps, mcpUrl: () => string): ChatService {
  const { config, logger } = deps;
  const limiter = new FixedWindowLimiter({ max: config.CHAT_RATE_LIMIT_PER_MIN, windowMs: 60_000, clock: deps.clock });
  const inFlight = new Set<string>();

  return {
    status: () => llmStatusOf(config),

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
      try {
        mcp = await connectLoopback(mcpUrl(), mintToken);
        const out = await runAgentTurn({
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
        logger.info(
          { userId: user.id, steps: out.steps, tools: toolNames(out.toolCalls), stoppedReason: out.stoppedReason, durationMs: Date.now() - started, usage: out.usage, provider: out.provider, model: out.model },
          'chat turn',
        );
        return out;
      } catch (err) {
        if (err instanceof AgentLlmError) {
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
            },
            'chat turn',
          );
        } else {
          logger.warn({ userId: user.id, code: 'INTERNAL', error: err instanceof Error ? err.name : 'unknown', durationMs: Date.now() - started }, 'chat turn');
        }
        throw err;
      } finally {
        await mcp?.close();
        inFlight.delete(user.id);
      }
    },
  };
}
