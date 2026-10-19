import { readFileSync } from 'node:fs';

/** From apps/gateway/package.json; `../package.json` resolves the same from src/ and dist/. */
export const GATEWAY_VERSION = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;
