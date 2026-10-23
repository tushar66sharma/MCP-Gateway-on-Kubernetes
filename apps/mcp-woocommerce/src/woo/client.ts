import { signOAuth1 } from './oauth1.js';
import { WooApiError } from './errors.js';

export type QueryValue = string | number | boolean | undefined;

/** What the tools need from WooCommerce; the real client and test fakes implement it. */
export interface WooApi {
  get<T>(path: string, query?: Record<string, QueryValue>): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
  put<T>(path: string, body: unknown): Promise<T>;
}

export interface WooClientOptions {
  baseUrl: string;          // oauth1: in-cluster, e.g. http://wordpress.store.svc.cluster.local; basic: https://shop.example.com
  signingBaseUrl: string;   // oauth1: public store URL with scheme http, e.g. http://store.localhost; ignored in basic mode
  authMode?: 'oauth1' | 'basic'; // default 'oauth1'
  consumerKey: string;
  consumerSecret: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

/** WooCommerce REST v3 client. Never retries: a retry would reuse a nonce and could duplicate writes. */
export class WooClient implements WooApi {
  constructor(private readonly o: WooClientOptions) {
    if (o.authMode === 'basic' && !o.baseUrl.startsWith('https://')) {
      throw new Error('WooClient: basic auth requires an https:// base URL');
    }
  }

  get<T>(path: string, query?: Record<string, QueryValue>): Promise<T> {
    return this.request<T>('GET', path, query, undefined);
  }
  post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, undefined, body);
  }
  put<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('PUT', path, undefined, body);
  }

  private async request<T>(method: string, path: string, query: Record<string, QueryValue> | undefined, body: unknown): Promise<T> {
    const url = new URL(`/wp-json/wc/v3${path}`, this.o.baseUrl);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    const basic = this.o.authMode === 'basic';
    const target = basic
      ? url.toString()
      : signOAuth1({
        method,
        url: url.toString(),
        signingBaseUrl: this.o.signingBaseUrl,
        consumerKey: this.o.consumerKey,
        consumerSecret: this.o.consumerSecret,
      });
    const headers: Record<string, string> = body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' };
    if (basic) {
      headers.authorization = `Basic ${Buffer.from(`${this.o.consumerKey}:${this.o.consumerSecret}`).toString('base64')}`;
    }
    const doFetch = this.o.fetchImpl ?? fetch;
    let res: Response;
    try {
      res = await doFetch(target, {
        method,
        redirect: 'manual',
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.o.timeoutMs),
      });
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new WooApiError(`WooCommerce did not respond within ${this.o.timeoutMs}ms`, 0, 'timeout');
      }
      throw new WooApiError('Could not reach WooCommerce (network error)', 0, 'network_error');
    }
    let text: string;
    try {
      text = await res.text();
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new WooApiError(`WooCommerce did not respond within ${this.o.timeoutMs}ms`, 0, 'timeout');
      }
      throw new WooApiError('Could not read the WooCommerce response (network error)', 0, 'network_error');
    }
    let data: unknown;
    try {
      data = text.length > 0 ? JSON.parse(text) : null;
    } catch {
      data = undefined;
    }
    if (!res.ok) {
      const obj = (data ?? {}) as { code?: unknown; message?: unknown };
      const code = typeof obj.code === 'string' ? this.safeCode(obj.code) : `http_${res.status}`;
      const message = typeof obj.message === 'string'
        ? this.redact(obj.message)
        : `HTTP ${res.status}: ${this.redact(text).slice(0, 120)}`;
      throw new WooApiError(message.slice(0, 200), res.status, code);
    }
    if (data === undefined) throw new WooApiError('WooCommerce returned a non-JSON response', res.status, 'bad_response');
    return data as T;
  }

  /** The server's error code may reach the model or logs: redact, keep only [a-z0-9_], cap at 64 chars. */
  private safeCode(code: string): string {
    const out = this.redact(code).toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 64);
    return out.length > 0 ? out : 'unknown_error';
  }

  /** Strips OAuth params and the configured credentials from text that may echo the signed URL. */
  private redact(text: string): string {
    let out = text.replace(/oauth_[a-z_]+=[^&\s"'<]*/gi, 'oauth_…=[redacted]');
    const basicHeader = Buffer.from(`${this.o.consumerKey}:${this.o.consumerSecret}`).toString('base64');
    for (const secret of [basicHeader, this.o.consumerKey, this.o.consumerSecret]) {
      if (secret.length > 0) out = out.split(secret).join('[redacted]');
    }
    return out;
  }
}
