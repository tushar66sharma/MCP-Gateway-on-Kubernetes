import { describe, expect, it } from 'vitest';
import { clientSnippets } from '../src/features/keys/clientSnippets';

const URL_ = 'https://gateway.example.com/mcp';
const KEY = `ugw_${'x'.repeat(43)}`;

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

describe('clientSnippets', () => {
  it('snippets contain url and key exactly once', () => {
    const s = clientSnippets(URL_, KEY);
    for (const text of [s.claudeCode, s.cursor, s.inspector]) {
      expect(count(text, URL_)).toBe(1);
      expect(count(text, KEY)).toBe(1);
    }
  });

  it('uses the documented forms', () => {
    const s = clientSnippets(URL_, KEY);
    expect(s.claudeCode).toBe(`claude mcp add --transport http urumi-gateway ${URL_} --header "Authorization: Bearer ${KEY}"`);
    expect(JSON.parse(s.cursor)).toEqual({ mcpServers: { 'urumi-gateway': { url: URL_, headers: { Authorization: `Bearer ${KEY}` } } } });
    expect(s.inspector).toBe(
      `npx -y @modelcontextprotocol/inspector@2.11.0 --cli ${URL_} --transport http --header "Authorization: Bearer ${KEY}" --method tools/list`,
    );
  });
});
