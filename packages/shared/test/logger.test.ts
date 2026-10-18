import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger } from '../src/logger.js';

describe('logger redaction', () => {
  it('does not write secret values', () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _enc, cb) {
        lines.push(chunk.toString());
        cb();
      },
    });
    const logger = createLogger('test', 'info', stream);
    logger.info(
      {
        ctx: { authorization: 'Bearer SUPERSECRETVALUE', token: 'TOKENVALUE123', consumerSecret: 'CSECRET456' },
        req: { headers: { authorization: 'Bearer HDRVALUE789' } },
      },
      'hello',
    );
    const out = lines.join('');
    expect(out).toContain('hello');
    for (const v of ['SUPERSECRETVALUE', 'TOKENVALUE123', 'CSECRET456', 'HDRVALUE789']) {
      expect(out).not.toContain(v);
    }
    expect(out).toContain('[REDACTED]');
  });
});
