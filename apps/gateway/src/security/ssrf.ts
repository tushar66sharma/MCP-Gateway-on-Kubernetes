import { promises as dns, type LookupAddress } from 'node:dns';
import { isIP, type LookupFunction } from 'node:net';

export type SsrfReason =
  | 'invalid_url'
  | 'scheme'
  | 'credentials_in_url'
  | 'dns_failed'
  | 'loopback'
  | 'link_local'
  | 'unspecified'
  | 'private';

export class SsrfError extends Error {
  readonly reason: SsrfReason;
  constructor(reason: SsrfReason, message: string) {
    super(message);
    this.name = 'SsrfError';
    this.reason = reason;
  }
}

export interface SsrfOptions {
  allowedInternalHosts: string[];
  allowLoopback?: boolean;
  lookup?: (host: string) => Promise<string[]>;
}

const defaultLookup = async (host: string): Promise<string[]> =>
  (await dns.lookup(host, { all: true })).map((a) => a.address);

function ipv4ToInt(ip: string): number {
  const p = ip.split('.').map(Number);
  return (((p[0] ?? 0) << 24) | ((p[1] ?? 0) << 16) | ((p[2] ?? 0) << 8) | (p[3] ?? 0)) >>> 0;
}

function inV4(n: number, base: string, bits: number): boolean {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return ((n & mask) >>> 0) === ((ipv4ToInt(base) & mask) >>> 0);
}

/** Expand an IPv6 literal into 8 hextets, or null if malformed. */
function parseV6(ip: string): number[] | null {
  let s = ip;
  const zone = s.indexOf('%');
  if (zone >= 0) s = s.slice(0, zone);
  const lastColon = s.lastIndexOf(':');
  const tail = s.slice(lastColon + 1);
  if (tail.includes('.')) {
    if (isIP(tail) !== 4) return null;
    const n = ipv4ToInt(tail);
    s = `${s.slice(0, lastColon + 1)}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves[1] ? halves[1].split(':') : [];
  let groups: string[];
  if (halves.length === 2) {
    const fill = 8 - head.length - rest.length;
    if (fill < 1) return null;
    groups = [...head, ...Array<string>(fill).fill('0'), ...rest];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;
  const out = groups.map((g) => (/^[0-9a-fA-F]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  return out.some(Number.isNaN) ? null : out;
}

type AddrClass = 'unspecified' | 'link_local' | 'loopback' | 'private' | 'public';

function classifyV4(ip: string): AddrClass {
  const n = ipv4ToInt(ip);
  if (inV4(n, '0.0.0.0', 8)) return 'unspecified';
  if (inV4(n, '169.254.0.0', 16)) return 'link_local';
  if (inV4(n, '127.0.0.0', 8)) return 'loopback';
  if (
    inV4(n, '10.0.0.0', 8) ||
    inV4(n, '172.16.0.0', 12) ||
    inV4(n, '192.168.0.0', 16) ||
    inV4(n, '100.64.0.0', 10)
  ) {
    return 'private';
  }
  return 'public';
}

const v4FromHextets = (hi: number, lo: number): string => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

function classify(addr: string): AddrClass | null {
  const kind = isIP(addr);
  if (kind === 4) return classifyV4(addr);
  if (kind !== 6) return null;
  const h = parseV6(addr);
  if (!h) return null;
  const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0, g = 0, last = 0] = h;
  if (h.every((x) => x === 0)) return 'unspecified';
  if (h.slice(0, 7).every((x) => x === 0) && last === 1) return 'loopback';
  // IPv6 forms that embed an IPv4 address in the low 32 bits are judged by the IPv4 rules:
  const zero64 = a === 0 && b === 0 && c === 0 && d === 0;
  if (
    (zero64 && e === 0 && f === 0) || // IPv4-compatible ::/96 (:: and ::1 handled above)
    (zero64 && e === 0 && f === 0xffff) || // IPv4-mapped ::ffff:0:0/96 (also the URL-normalized ::ffff:7f00:1 form)
    (zero64 && e === 0xffff && f === 0) || // IPv4-translated ::ffff:0:0:0/96 (RFC 2765)
    (a === 0x64 && b === 0xff9b && c === 0 && d === 0 && e === 0 && f === 0) // NAT64 64:ff9b::/96 (RFC 6052)
  ) {
    return classifyV4(v4FromHextets(g, last));
  }
  if ((a & 0xffc0) === 0xfe80) return 'link_local';
  if ((a & 0xfe00) === 0xfc00) return 'private';
  return 'public';
}

/** Entry is an exact name, or `*.suffix` matching one or more labels before the suffix. */
function hostAllowed(host: string, allowed: string[]): boolean {
  const h = host.toLowerCase();
  return allowed.some((entry) => {
    const e = entry.toLowerCase();
    if (e.startsWith('*.')) {
      const suffix = e.slice(1);
      return h.length > suffix.length && h.endsWith(suffix);
    }
    return h === e;
  });
}

const ARTICLE: Record<Exclude<AddrClass, 'public'>, string> = {
  unspecified: 'an unspecified',
  link_local: 'a link-local',
  loopback: 'a loopback',
  private: 'a private',
};

/**
 * The one place addresses are judged, shared by the URL check and the connect-time lookup.
 * Throws SsrfError on the first blocked address; `host` is the name as written in the URL.
 */
function assertAddressesAllowed(host: string, addrs: string[], o: SsrfOptions): void {
  if (addrs.length === 0) throw new SsrfError('dns_failed', `could not resolve ${host}`);
  const internalOk = hostAllowed(host, o.allowedInternalHosts);
  for (const addr of addrs) {
    const c = classify(addr);
    if (c === null) throw new SsrfError('dns_failed', `${host} resolved to an unrecognised address`);
    if (c === 'public') continue;
    if (c === 'loopback' && o.allowLoopback) continue;
    if (c === 'private' && internalOk) continue;
    const suffix = c === 'private' ? ' and is not allowlisted' : '';
    throw new SsrfError(c, `${host} resolves to ${ARTICLE[c]} address${suffix}`);
  }
}

export async function assertSafeUpstreamUrl(url: string, o: SsrfOptions): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SsrfError('invalid_url', 'upstream URL is not a valid URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new SsrfError('scheme', `upstream URL scheme ${parsed.protocol} is not allowed`);
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw new SsrfError('credentials_in_url', 'upstream URL must not contain credentials');
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  let addrs: string[];
  if (isIP(host) !== 0) {
    addrs = [host];
  } else {
    try {
      addrs = await (o.lookup ?? defaultLookup)(host);
    } catch {
      throw new SsrfError('dns_failed', `could not resolve ${host}`);
    }
  }
  assertAddressesAllowed(host, addrs, o);
  return parsed;
}

/**
 * A `dns.lookup`-compatible resolver for the HTTP client's connect step. It closes the DNS-rebinding
 * window left by assertSafeUpstreamUrl: the name is resolved again when the socket opens, and every
 * address of that answer is judged by the same rules before the socket may use it.
 * A failed resolution is passed through unchanged (it keeps its ENOTFOUND / EAI_AGAIN code).
 */
export function createSafeLookup(o: SsrfOptions): LookupFunction {
  const resolve = o.lookup ?? defaultLookup;
  return (hostname, options, callback) => {
    resolve(hostname).then(
      (addrs) => {
        try {
          assertAddressesAllowed(hostname, addrs, o);
        } catch (err) {
          callback(err as SsrfError, options.all ? [] : '');
          return;
        }
        const wanted = options.family === 4 || options.family === 'IPv4' ? 4 : options.family === 6 || options.family === 'IPv6' ? 6 : 0;
        const list: LookupAddress[] = addrs.map((address) => ({ address, family: isIP(address) })).filter((a) => wanted === 0 || a.family === wanted);
        const first = list[0];
        if (!first) {
          callback(new SsrfError('dns_failed', `could not resolve ${hostname}`), options.all ? [] : '');
          return;
        }
        if (options.all) callback(null, list);
        else callback(null, first.address, first.family);
      },
      (err: unknown) => {
        const e = err instanceof Error ? (err as NodeJS.ErrnoException) : new SsrfError('dns_failed', `could not resolve ${hostname}`);
        callback(e, options.all ? [] : '');
      },
    );
  };
}
