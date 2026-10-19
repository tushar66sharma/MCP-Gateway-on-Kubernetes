export type LlmErrorCode = 'LLM_RATE_LIMITED' | 'LLM_AUTH_FAILED' | 'LLM_UNAVAILABLE' | 'LLM_BAD_RESPONSE' | 'LLM_NOT_CONFIGURED';

/**
 * The message is fixed text written here. A provider's response body is never put into it (the body can
 * echo request content, which includes the user's chat messages).
 */
export class LlmError extends Error {
  readonly code: LlmErrorCode;
  readonly retryAfterSec?: number;
  readonly provider?: string;

  constructor(code: LlmErrorCode, message: string, opts: { retryAfterSec?: number; provider?: string } = {}) {
    super(message);
    this.name = 'LlmError';
    this.code = code;
    if (opts.retryAfterSec !== undefined) this.retryAfterSec = opts.retryAfterSec;
    if (opts.provider !== undefined) this.provider = opts.provider;
  }
}
