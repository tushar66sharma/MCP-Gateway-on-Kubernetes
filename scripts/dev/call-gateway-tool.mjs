// Calls one tool through the gateway's /mcp endpoint and prints a short result line.
// Usage: GW_KEY=<api key> node scripts/dev/call-gateway-tool.mjs --url http://app.localhost/mcp --slug <slug> --tool <tool> --args '{"expression":"6*7"}'
// Also prints how many tools the gateway lists under that slug. The key is read from env GW_KEY and never printed.
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const args = process.argv.slice(2);
const argValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const url = argValue('--url');
const slug = argValue('--slug');
const tool = argValue('--tool');
const toolArgs = JSON.parse(argValue('--args') ?? '{}');
const key = process.env.GW_KEY;
if (!url || !slug || !tool || !key) {
  console.error('usage: GW_KEY=<key> node scripts/dev/call-gateway-tool.mjs --url <mcp url> --slug <slug> --tool <tool> [--args <json>]');
  process.exit(1);
}

const client = new Client({ name: 'call-gateway-tool', version: '0.1.0' }, { versionNegotiation: { mode: 'auto' } });
try {
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${key}` } } }));
  const { tools } = await client.listTools();
  const mine = tools.filter((t) => t.name.startsWith(slug));
  const target = mine.find((t) => t.name.endsWith(tool));
  if (!target) throw new Error(`no tool ending in ${tool} under ${slug}; found ${mine.length} tools for the slug`);
  const res = await client.callTool({ name: target.name, arguments: toolArgs });
  const text = (res.content ?? []).map((c) => (c.type === 'text' ? c.text : '')).join(' ').slice(0, 200);
  console.log(`slug ${slug}: ${mine.length} tools listed; ${target.name} isError=${res.isError === true}; result: ${text}`);
  process.exitCode = res.isError ? 1 : 0;
} catch (err) {
  console.error(`call failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  await client.close().catch(() => undefined);
}
