// End-to-end smoke test for an MCP server over Streamable HTTP.
// Usage: MCP_TOKEN=... node scripts/dev/mcp-smoke.mjs --url http://127.0.0.1:13001/mcp [--write]
// The token is read from env MCP_TOKEN and is never printed.
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const args = process.argv.slice(2);
const argValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const url = argValue('--url');
const write = args.includes('--write');
const token = process.env.MCP_TOKEN;
if (!url || !token) {
  console.error('usage: MCP_TOKEN=<token> node scripts/dev/mcp-smoke.mjs --url <mcp url> [--write]');
  process.exit(1);
}

const client = new Client({ name: 'mcp-smoke', version: '0.1.0' }, { versionNegotiation: { mode: 'auto' } });

async function call(name, argumentsObj) {
  const res = await client.callTool({ name, arguments: argumentsObj });
  if (res.isError) {
    const text = (res.content ?? []).map((c) => (c.type === 'text' ? c.text : '')).join(' ').slice(0, 300);
    throw new Error(`${name} returned an error: ${text}`);
  }
  return res.structuredContent ?? {};
}

function assert(condition, message) {
  if (!condition) throw new Error(`assertion failed: ${message}`);
}

try {
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }),
  );
  const { tools } = await client.listTools();
  if (tools.length !== 6) throw new Error(`expected 6 tools, got ${tools.length}: ${tools.map((t) => t.name).join(', ')}`);
  console.log(`tools (6): ${tools.map((t) => t.name).join(', ')}`);

  const ping = await call('ping', {});
  assert(ping.ok === true, 'ping did not return structuredContent.ok === true');
  console.log(`ping: ok=${ping.ok}`);

  const products = await call('list_products', { per_page: 3 });
  assert(Array.isArray(products.products), 'list_products did not return a products array');
  const plist = products.products;
  console.log(`list_products: ${plist.length} returned, ids=[${plist.map((p) => p.id).join(', ')}]`);

  const today = await call('list_orders', { period: 'today' });
  assert(Array.isArray(today.orders), 'list_orders did not return an orders array');
  console.log(`list_orders today: ${today.orders.length} order(s)`);

  if (write) {
    // A JSON number price exercises the string|number schema (normalised to "1.00").
    const created = await call('create_product', {
      name: `MCP smoke ${new Date().toISOString()}`,
      regular_price: 1,
      status: 'draft',
    });
    const id = created.product?.id;
    assert(typeof id === 'number' && Number.isInteger(id) && id > 0, 'create_product did not return a numeric product.id');
    console.log(`create_product: id=${id} status=${created.product?.status} regular_price=${created.product?.regular_price}`);

    const latest = await call('list_orders', { per_page: 1 });
    assert(Array.isArray(latest.orders), 'list_orders did not return an orders array');
    const order = latest.orders[0];
    if (order) {
      const updated = await call('update_order_status', { order_id: order.id, status: order.status });
      assert(updated.order?.id === order.id, 'update_order_status returned a different order id');
      console.log(`update_order_status: order ${order.id} kept as ${updated.order?.status} (signed PUT ok)`);
    } else {
      console.log('update_order_status: skipped (no orders yet)');
    }
  }
  console.log('MCP smoke test passed.');
  await client.close();
} catch (err) {
  console.error(`MCP smoke test FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
