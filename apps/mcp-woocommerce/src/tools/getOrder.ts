import { z } from 'zod';
import { fail, ok, toOrderDetail } from './format.js';
import { defineTool } from './types.js';

export const getOrder = defineTool({
  name: 'get_order',
  title: 'Get order',
  description: 'Get one order with items, totals, customer and payment method.',
  inputSchema: z.object({ order_id: z.number().int().min(1) }),
  handler: async ({ order_id }, { woo }) => {
    try {
      const order = toOrderDetail(await woo.get<Record<string, unknown>>(`/orders/${order_id}`));
      return ok(`Order #${order.number} is ${order.status}, total ${order.total} ${order.currency}.`, { order });
    } catch (err) {
      return fail(err);
    }
  },
});
