import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger } from '../src/logger.js';

function capture(): { logger: ReturnType<typeof createLogger>; output: () => string } {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  return { logger: createLogger('test', 'info', stream), output: () => lines.join('') };
}

describe('logger redaction', () => {
  it('does not write secret values', () => {
    const { logger, output } = capture();
    logger.info(
      {
        ctx: { authorization: 'Bearer SUPERSECRETVALUE', token: 'TOKENVALUE123', consumerSecret: 'CSECRET456' },
        req: { headers: { authorization: 'Bearer HDRVALUE789' } },
      },
      'hello',
    );
    const out = output();
    expect(out).toContain('hello');
    for (const v of ['SUPERSECRETVALUE', 'TOKENVALUE123', 'CSECRET456', 'HDRVALUE789']) {
      expect(out).not.toContain(v);
    }
    expect(out).toContain('[REDACTED]');
  });

  it('redacts the x-utilities-key header and apiKey fields (pino paths)', () => {
    const { logger, output } = capture();
    logger.info({ req: { headers: { 'x-utilities-key': 'UTILKEY111' } }, user: { apiKey: 'APIKEY222' }, apiKey: 'APIKEY333' }, 'hdr');
    const out = output();
    for (const v of ['UTILKEY111', 'APIKEY222', 'APIKEY333']) expect(out).not.toContain(v);
    expect(JSON.parse(out)).toMatchObject({
      req: { headers: { 'x-utilities-key': '[REDACTED]' } }, user: { apiKey: '[REDACTED]' }, apiKey: '[REDACTED]',
    });
  });

  it('censors keys ending in key/secret at the top level (suffix rule)', () => {
    const { logger, output } = capture();
    logger.info({ wooConsumerKey: 'TOPKEY444', clientSecret: 'TOPSECRET555', keep: 'visible' }, 'top');
    const out = output();
    expect(out).not.toContain('TOPKEY444');
    expect(out).not.toContain('TOPSECRET555');
    expect(JSON.parse(out)).toMatchObject({ wooConsumerKey: '[REDACTED]', clientSecret: '[REDACTED]', keep: 'visible' });
  });

  it('censors suffix keys in nested objects and arrays, keeping other values', () => {
    const { logger, output } = capture();
    logger.info(
      {
        a: { b: { c: { privateKey: 'DEEPKEY666', note: 'kept' } } },
        list: [{ sharedSecret: 'ARRSECRET777' }],
        req: { headers: { 'x-api-key': 'XAPIKEY888' } },
      },
      'nested',
    );
    const out = output();
    for (const v of ['DEEPKEY666', 'ARRSECRET777', 'XAPIKEY888']) expect(out).not.toContain(v);
    expect(JSON.parse(out)).toMatchObject({
      a: { b: { c: { privateKey: '[REDACTED]', note: 'kept' } } },
      list: [{ sharedSecret: '[REDACTED]' }],
      req: { headers: { 'x-api-key': '[REDACTED]' } },
    });
  });

  it('does not mutate the logged object and survives cycles', () => {
    const { logger, output } = capture();
    const obj: Record<string, unknown> = { inner: { apiKey: 'CYCLEKEY999' } };
    obj.self = obj;
    logger.info(obj, 'cycle');
    expect(output()).not.toContain('CYCLEKEY999');
    expect(JSON.parse(output())).toMatchObject({ self: '[Circular]' });
    expect((obj.inner as { apiKey: string }).apiKey).toBe('CYCLEKEY999');
  });

  it('does not leak keys nested deeper than the walk limit', () => {
    const { logger, output } = capture();
    let deep: Record<string, unknown> = { apiKey: 'TOODEEP000' };
    for (let i = 0; i < 20; i++) deep = { next: deep };
    logger.info(deep, 'deep');
    expect(output()).not.toContain('TOODEEP000');
    expect(output()).toContain('[Truncated]');
  });

  it('keeps shared (non-circular) references and error messages', () => {
    const { logger, output } = capture();
    const shared = { id: 1 };
    logger.info({ a: shared, b: shared, err: new Error('boom') }, 'shared');
    expect(JSON.parse(output())).toMatchObject({ a: { id: 1 }, b: { id: 1 }, err: { message: 'boom' } });
  });
});
