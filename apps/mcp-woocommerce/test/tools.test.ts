import { describe, expect, it } from 'vitest';
import { wooTools } from '../src/tools/index.js';
import type { ToolDeps, ToolResult } from '../src/tools/types.js';
import { WooApiError } from '../src/woo/errors.js';
import type { QueryValue, WooApi } from '../src/woo/client.js';

interface Call { method: 'GET' | 'POST' | 'PUT'; path: string; query?: Record<string, QueryValue>; body?: unknown }

class FakeWoo implements WooApi {
  calls: Call[] = [];
  constructor(private readonly respond: (c: Call) => unknown) {}
  private run<T>(c: Call): Promise<T> {
    this.calls.push(c);
    try {
      return Promise.resolve(this.respond(c) as T);
    } catch (e) {
      return Promise.reject(e instanceof Error ? e : new Error(String(e)));
    }
  }
  get<T>(path: string, query?: Record<string, QueryValue>): Promise<T> { return this.run({ method: 'GET', path, query }); }
  post<T>(path: string, body: unknown): Promise<T> { return this.run({ method: 'POST', path, body }); }
  put<T>(path: string, body: unknown): Promise<T> { return this.run({ method: 'PUT', path, body }); }
}

const rawProduct = {
  id: 7, name: 'Demo Mug', status: 'publish', price: '12.50', regular_price: '12.50',
  stock_status: 'instock', permalink: 'http://store.localhost/product/demo-mug/', slug: 'demo-mug', extra: 1,
};
const rawOrder = {
  id: 15, number: '15', status: 'processing', currency: 'INR', total: '499.00',
  date_created_gmt: '2026-10-18T10:00:00', date_paid_gmt: '2026-10-18T10:05:00',
  billing: { first_name: 'Asha', last_name: 'Rao', email: 'asha@example.com' },
  payment_method_title: 'Cash on delivery',
  line_items: [{ id: 1, name: 'Demo Mug', quantity: 2, total: '25.00', sku: 'x' }, { id: 2, name: 'Tote', quantity: 1, total: '5.00' }],
};

function setup(respond: (c: Call) => unknown, storeTimeZone = 'UTC'): { woo: FakeWoo; deps: ToolDeps } {
  const woo = new FakeWoo(respond);
  return { woo, deps: { woo, storeTimeZone, now: () => new Date('2026-10-18T20:00:00Z') } };
}

function tool(name: string) {
  const t = wooTools.find((x) => x.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return t;
}
function run(name: string, args: unknown, deps: ToolDeps): Promise<ToolResult> {
  const t = tool(name);
  return t.handler(t.inputSchema.parse(args), deps);
}

describe('wooTools registry', () => {
  it('has exactly the six tools with valid names and short descriptions', () => {
    expect(wooTools.map((t) => t.name)).toEqual([
      'list_products', 'create_product', 'list_orders', 'get_order', 'update_order_status', 'ping',
    ]);
    for (const t of wooTools) {
      expect(t.name).toMatch(/^[a-z_]{1,40}$/);
      expect(t.description.length).toBeLessThanOrEqual(200);
    }
  });
});

describe('list_products', () => {
  it('calls GET /products without status=any and returns ProductSummary', async () => {
    const { woo, deps } = setup(() => [rawProduct]);
    const res = await run('list_products', {}, deps);
    expect(woo.calls).toHaveLength(1);
    expect(woo.calls[0]?.method).toBe('GET');
    expect(woo.calls[0]?.path).toBe('/products');
    expect(woo.calls[0]?.query).toMatchObject({ per_page: 10, page: 1 });
    expect(woo.calls[0]?.query).not.toHaveProperty('status');
    const products = res.structuredContent?.products as Record<string, unknown>[];
    expect(Object.keys(products[0] ?? {}).sort()).toEqual(
      ['id', 'name', 'permalink', 'price', 'regular_price', 'status', 'stock_status'],
    );
    expect(res.structuredContent).toMatchObject({ page: 1, per_page: 10 });
    expect(res.isError).toBeUndefined();
  });

  it('returns compact JSON text (no indentation) to save model tokens', async () => {
    const { deps } = setup(() => [rawProduct]);
    const res = await run('list_products', {}, deps);
    const [summary, json, ...rest] = (res.content[0]?.text ?? '').split('\n');
    expect(summary).toBe('Found 1 product(s) on page 1.');
    expect(rest).toEqual([]);
    expect(json).toBe(JSON.stringify(res.structuredContent));
  });

  it('passes search and a concrete status through', async () => {
    const { woo, deps } = setup(() => []);
    await run('list_products', { search: 'mug', status: 'draft', page: 2, per_page: 5 }, deps);
    expect(woo.calls[0]?.query).toMatchObject({ search: 'mug', status: 'draft', page: 2, per_page: 5 });
  });

  it('rejects per_page above 50', () => {
    expect(tool('list_products').inputSchema.safeParse({ per_page: 51 }).success).toBe(false);
  });
});

describe('create_product', () => {
  it('POSTs a simple published product and mentions the permalink', async () => {
    const { woo, deps } = setup(() => rawProduct);
    const res = await run('create_product', { name: 'Demo Mug', regular_price: '12.50' }, deps);
    expect(woo.calls[0]).toMatchObject({
      method: 'POST', path: '/products',
      body: { name: 'Demo Mug', type: 'simple', regular_price: '12.50', status: 'publish' },
    });
    expect(res.content[0]?.text).toContain('http://store.localhost/product/demo-mug/');
    expect((res.structuredContent?.product as Record<string, unknown>).id).toBe(7);
  });

  it.each([
    [12.5, '12.50'],
    ['12.50', '12.50'],
    ['12', '12'],
    [7, '7.00'],
    [0, '0.00'],
  ])('accepts regular_price %j and sends %j', async (price, sent) => {
    const { woo, deps } = setup(() => rawProduct);
    await run('create_product', { name: 'Mug', regular_price: price }, deps);
    expect((woo.calls[0]?.body as { regular_price: unknown }).regular_price).toBe(sent);
  });

  it.each([12.555, -1, '-1', '12.505', 'abc', 0.1 + 0.2, Number.NaN, Number.POSITIVE_INFINITY, 1e21])(
    'rejects regular_price %j',
    (price) => {
      expect(tool('create_product').inputSchema.safeParse({ name: 'x', regular_price: price }).success).toBe(false);
    },
  );
});

describe('list_orders', () => {
  it('resolves period=today in the store time zone', async () => {
    const { woo, deps } = setup(() => [rawOrder], 'Asia/Kolkata');
    const res = await run('list_orders', { period: 'today' }, deps);
    expect(woo.calls[0]?.path).toBe('/orders');
    // Naive UTC strings: WP_Date_Query would shift a Z/offset string into site-local time.
    expect(woo.calls[0]?.query).toMatchObject({
      after: '2026-10-18T18:30:00', before: '2026-10-19T18:30:00',
      dates_are_gmt: true, per_page: 10, page: 1, orderby: 'date', order: 'desc',
    });
    expect(woo.calls[0]?.query).not.toHaveProperty('status');
    expect(res.structuredContent?.range).toEqual({
      after: '2026-10-18T18:30:00.000Z', before: '2026-10-19T18:30:00.000Z', timeZone: 'Asia/Kolkata',
    });
    const orders = res.structuredContent?.orders as Record<string, unknown>[];
    expect(orders[0]).toEqual({
      id: 15, number: '15', status: 'processing', currency: 'INR', total: '499.00',
      date_created_gmt: '2026-10-18T10:00:00', customer: 'Asha Rao', item_count: 3,
    });
  });

  it('sends no Z and no +hh:mm offset in the WooCommerce date bounds', async () => {
    const cases: Record<string, string>[] = [
      { period: 'today' }, { period: 'yesterday' }, { period: 'last_7_days' },
      { after: '2026-10-01T00:00:00+05:30', before: '2026-10-02T00:00:00Z' },
    ];
    for (const args of cases) {
      const { woo, deps } = setup(() => [], 'Asia/Kolkata');
      await run('list_orders', args, deps);
      for (const key of ['after', 'before'] as const) {
        const v = String(woo.calls[0]?.query?.[key]);
        expect(v).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/);
        expect(v).not.toMatch(/[zZ]|[+-]\d\d:\d\d$/);
      }
    }
  });

  it('normalises explicit after/before to UTC and reports the UTC window', async () => {
    const { woo, deps } = setup(() => []);
    const res = await run('list_orders', { after: '2026-10-01T00:00:00+05:30', status: 'completed' }, deps);
    expect(woo.calls[0]?.query).toMatchObject({ after: '2026-09-30T18:30:00', status: 'completed', dates_are_gmt: true });
    expect(woo.calls[0]?.query).not.toHaveProperty('before');
    expect(res.structuredContent?.range).toEqual({ after: '2026-09-30T18:30:00.000Z' });
  });

  it('drops milliseconds from explicit bounds', async () => {
    const { woo, deps } = setup(() => []);
    await run('list_orders', { before: '2026-10-01T10:20:30.999Z' }, deps);
    expect(woo.calls[0]?.query).toMatchObject({ before: '2026-10-01T10:20:30' });
  });

  it('rejects period together with after', () => {
    const r = tool('list_orders').inputSchema.safeParse({ period: 'today', after: '2026-10-01T00:00:00Z' });
    expect(r.success).toBe(false);
  });

  it('rejects an unknown status and bad datetimes', () => {
    expect(tool('list_orders').inputSchema.safeParse({ status: 'shipped' }).success).toBe(false);
    for (const after of ['yesterday-ish', '2026-10-18', '2026-10-18T00:00:00', '2026-13-01T00:00:00Z', '2026-10-18T00:00:00+0530']) {
      expect(tool('list_orders').inputSchema.safeParse({ after }).success, after).toBe(false);
    }
  });

  it('accepts date-times with Z, lowercase z, an offset, and without seconds', () => {
    for (const after of ['2026-10-18T00:00:00Z', '2026-10-18T00:00:00z', '2026-10-18T00:00:00+05:30', '2026-10-18T00:00-04:00', '2026-10-18T00:00:00.123Z']) {
      expect(tool('list_orders').inputSchema.safeParse({ after }).success, after).toBe(true);
    }
  });

  it('bounds page at 1000', () => {
    expect(tool('list_orders').inputSchema.safeParse({ page: 1001 }).success).toBe(false);
    expect(tool('list_products').inputSchema.safeParse({ page: 1001 }).success).toBe(false);
  });
});

describe('get_order', () => {
  it('maps line items and detail fields', async () => {
    const { woo, deps } = setup(() => rawOrder);
    const res = await run('get_order', { order_id: 15 }, deps);
    expect(woo.calls[0]).toMatchObject({ method: 'GET', path: '/orders/15' });
    expect(res.structuredContent?.order).toMatchObject({
      id: 15, customer: 'Asha Rao', billing_email: 'asha@example.com',
      payment_method_title: 'Cash on delivery', date_paid_gmt: '2026-10-18T10:05:00', item_count: 3,
      line_items: [{ name: 'Demo Mug', quantity: 2, total: '25.00' }, { name: 'Tote', quantity: 1, total: '5.00' }],
    });
  });
});

describe('update_order_status', () => {
  it('PUTs the new status', async () => {
    const { woo, deps } = setup(() => ({ ...rawOrder, status: 'completed' }));
    const res = await run('update_order_status', { order_id: 15, status: 'completed' }, deps);
    expect(woo.calls[0]).toMatchObject({ method: 'PUT', path: '/orders/15', body: { status: 'completed' } });
    expect((res.structuredContent?.order as Record<string, unknown>).status).toBe('completed');
    expect(res.structuredContent).not.toHaveProperty('previous_status');
  });

  it('rejects an unknown status', () => {
    expect(tool('update_order_status').inputSchema.safeParse({ order_id: 15, status: 'shipped' }).success).toBe(false);
  });
});

describe('error handling', () => {
  it('maps WooApiError with a status', async () => {
    const { deps } = setup(() => { throw new WooApiError('Invalid ID.', 404, 'woocommerce_rest_shop_order_invalid_id'); });
    const res = await run('get_order', { order_id: 999 }, deps);
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toBe('WooCommerce returned 404: Invalid ID.');
  });

  it('maps status 0 to a request failure', async () => {
    const { deps } = setup(() => { throw new WooApiError('Could not reach WooCommerce (network error)', 0, 'network_error'); });
    const res = await run('list_products', {}, deps);
    expect(res.content[0]?.text).toBe('WooCommerce request failed (network_error): Could not reach WooCommerce (network error)');
    expect(res.isError).toBe(true);
  });

  it('maps unknown errors without a stack', async () => {
    const { deps } = setup(() => { throw new Error('boom'); });
    const res = await run('list_products', {}, deps);
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toBe('Unexpected error: boom');
    expect(res.content[0]?.text).not.toContain(' at ');
  });
});

describe('ping', () => {
  it('returns ok without calling WooCommerce', async () => {
    const { woo, deps } = setup(() => { throw new Error('should not be called'); });
    const res = await run('ping', {}, deps);
    expect(woo.calls).toHaveLength(0);
    expect(res.structuredContent).toEqual({ ok: true, server: 'mcp-woocommerce', time: '2026-10-18T20:00:00.000Z' });
  });
});
