import express from 'express';
import { z } from 'zod';
import { currentUser, requireSession } from '../auth/middleware.js';
import { AgentLlmError } from '../chat/agent.js';
import type { LlmErrorCode } from '../chat/llm/errors.js';
import { createChatService } from '../chat/service.js';
import type { GatewayDeps } from '../server.js';
import { ApiError } from './errors.js';
import { parseBody } from './validate.js';

/** The client sends only user and assistant turns: never `system` or `tool` (Global Constraints). */
const chatBody = z
  .object({
    messages: z
      .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1).max(4000) }).strict())
      .min(1)
      .max(20)
      .refine((m) => m.at(-1)?.role === 'user', { message: 'The last message must be from the user' }),
  })
  .strict();

const LLM_STATUS: Record<LlmErrorCode, number> = {
  LLM_NOT_CONFIGURED: 503,
  LLM_RATE_LIMITED: 429,
  LLM_AUTH_FAILED: 502,
  LLM_UNAVAILABLE: 502,
  LLM_BAD_RESPONSE: 502,
};

/** Used when a provider's 429 gave no retry-after: the free tiers' limits are per minute. */
const DEFAULT_LLM_RETRY_AFTER_SEC = 60;

/** `GET /chat/status` and `POST /chat` (spec §6.2, §6.9), both behind a session; CSRF applies to the POST. */
export function createChatRouter(deps: GatewayDeps, mcpUrl: () => string): express.Router {
  const router = express.Router();
  const session = requireSession(deps);
  const chat = createChatService(deps, mcpUrl);

  router.get('/chat/status', session, (_req, res) => {
    res.json(chat.status());
  });

  router.post('/chat', session, async (req, res) => {
    const { messages } = parseBody(chatBody, req.body);
    // The client went away before the reply was written: stop the turn. (`req`'s own 'close' fires as soon
    // as the body has been read on current Node, so the response's 'close' is the one that means it.)
    const client = new AbortController();
    const onClose = () => {
      if (!res.writableEnded) client.abort();
    };
    res.on('close', onClose);
    try {
      const out = await chat.runTurn(currentUser(res), messages, client.signal);
      res.json({ reply: out.reply, toolCalls: out.toolCalls, stoppedReason: out.stoppedReason, provider: out.provider, model: out.model, usage: out.usage });
    } catch (err) {
      if (err instanceof AgentLlmError) {
        const e = err.llmError;
        const status = LLM_STATUS[e.code];
        // The executed tool calls are returned so the user sees what already ran and does not retry blindly.
        const details: Record<string, unknown> = { toolCalls: err.toolCalls };
        if (status === 429) {
          const after = e.retryAfterSec ?? DEFAULT_LLM_RETRY_AFTER_SEC;
          res.setHeader('Retry-After', String(after));
          details.retryAfterSec = after;
        }
        throw new ApiError(status, e.code, e.message, details);
      }
      if (err instanceof ApiError && err.code === 'RATE_LIMITED' && typeof err.details?.retryAfterSec === 'number') {
        res.setHeader('Retry-After', String(err.details.retryAfterSec));
      }
      throw err;
    } finally {
      res.off('close', onClose);
    }
  });

  return router;
}
