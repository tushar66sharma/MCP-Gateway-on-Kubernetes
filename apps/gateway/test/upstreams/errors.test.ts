import { ProtocolError, SdkError, SdkErrorCode, SdkHttpError } from '@modelcontextprotocol/client';
import { describe, expect, it } from 'vitest';
import { SsrfError } from '../../src/security/ssrf.js';
import { describeUpstreamError, isConnectionLevelError, UpstreamRedirectError } from '../../src/upstreams/errors.js';

// Shapes as observed from the SDK 2.3.1 client + undici against the test fakes.
const withCode = (code: string, message = code) => Object.assign(new Error(message), { code });
const fetchFailed = (cause: unknown) => new TypeError('fetch failed', { cause });
const probeFailed = (cause: unknown) => new SdkError(SdkErrorCode.EraNegotiationFailed, `Version negotiation probe failed: ${String((cause as Error).message)}`, { cause }, { cause });

describe('describeUpstreamError', () => {
  it.each<[string, unknown, string]>([
    ['refused at connect', probeFailed(fetchFailed(withCode('ECONNREFUSED', 'connect ECONNREFUSED 127.0.0.1:1'))), 'connection refused'],
    ['refused, both families', probeFailed(fetchFailed(Object.assign(new AggregateError([withCode('ECONNREFUSED')]), { code: 'ECONNREFUSED' }))), 'connection refused'],
    ['refused during a call', fetchFailed(withCode('ECONNREFUSED')), 'connection refused'],
    ['reset keep-alive socket', fetchFailed(withCode('ECONNRESET', 'read ECONNRESET')), 'connection reset'],
    ['undici other side closed', fetchFailed(withCode('UND_ERR_SOCKET', 'other side closed')), 'connection reset'],
    ['ENOTFOUND', probeFailed(fetchFailed(withCode('ENOTFOUND', 'getaddrinfo ENOTFOUND x.invalid'))), 'DNS lookup failed'],
    ['EAI_AGAIN', fetchFailed(withCode('EAI_AGAIN')), 'DNS lookup failed'],
    ['request timeout', new SdkError(SdkErrorCode.RequestTimeout, 'Request timed out', { timeout: 500 }), 'timeout after 500ms'],
    ['abort signal timeout', fetchFailed(new DOMException('The operation was aborted due to timeout', 'TimeoutError')), 'timeout after 500ms'],
    ['401 on the probe', new SdkHttpError(SdkErrorCode.ClientHttpAuthentication, 'Version negotiation failed', { status: 401, statusText: 'Unauthorized' }), 'HTTP 401 from upstream'],
    ['404 with a body', new SdkHttpError(SdkErrorCode.ClientHttpNotImplemented, 'Error POSTing to endpoint: <html>secret body</html>', { status: 404, statusText: 'Not Found' }), 'HTTP 404 from upstream'],
    ['302', probeFailed(new UpstreamRedirectError(302)), 'HTTP 302 from upstream (redirects are not followed)'],
    ['ssrf at connect', probeFailed(fetchFailed(new SsrfError('loopback', 'x resolves to a loopback address'))), 'blocked by SSRF guard (loopback)'],
    ['ssrf dns_failed', new SsrfError('dns_failed', 'could not resolve x'), 'DNS lookup failed'],
    ['anything else', new Error('x'.repeat(300)), `error: ${'x'.repeat(200)}`],
  ])('%s', (_label, err, expected) => {
    expect(describeUpstreamError(err, 500)).toBe(expected);
  });
});

describe('isConnectionLevelError', () => {
  it('is true for link failures', () => {
    expect(isConnectionLevelError(fetchFailed(withCode('ECONNREFUSED')))).toBe(true);
    expect(isConnectionLevelError(fetchFailed(withCode('ECONNRESET')))).toBe(true);
    expect(isConnectionLevelError(new SdkHttpError(SdkErrorCode.ClientHttpNotImplemented, 'x', { status: 502 }))).toBe(true);
    expect(isConnectionLevelError(new UpstreamRedirectError(301))).toBe(true);
  });
  it('is true only for HTTP statuses that concern the whole server (401/403/404/5xx)', () => {
    const http = (status: number) => new SdkHttpError(SdkErrorCode.ClientHttpNotImplemented, 'x', { status });
    for (const status of [401, 403, 404, 500, 502, 503]) expect(isConnectionLevelError(http(status)), String(status)).toBe(true);
    for (const status of [400, 405, 409, 413, 415, 422, 429]) expect(isConnectionLevelError(http(status)), String(status)).toBe(false);
    expect(isConnectionLevelError(probeFailed(http(413)))).toBe(false);
  });
  it('is false for timeouts and upstream JSON-RPC errors', () => {
    expect(isConnectionLevelError(new SdkError(SdkErrorCode.RequestTimeout, 'Request timed out'))).toBe(false);
    expect(isConnectionLevelError(new ProtocolError(-32602, 'Tool nope not found'))).toBe(false);
    expect(isConnectionLevelError(new SdkError(SdkErrorCode.InvalidResult, 'bad output'))).toBe(false);
  });
});
