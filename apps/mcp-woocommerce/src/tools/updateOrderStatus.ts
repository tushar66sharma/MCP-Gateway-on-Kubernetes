import { z } from 'zod';
import { fail, ok, toOrderSummary } from './format.js';
import { ORDER_STATUSES } from './listOrders.js';
import { defineTool } from './types.js';

export const updateOrderStatus = defineTool({
  name: 'update_order_status',
  title: 'Update order status',
  description: "Change an order's status (pending, processing, on-hold, completed, cancelled, refunded, failed).",
  inputSchema: z.object({ order_id: z.number().int().min(1), status: z.enum(ORDER_STATUSES) }),
  handler: async ({ order_id, status }, { woo }) => {
    try {
      const order = toOrderSummary(await woo.put<Record<string, unknown>>(`/orders/${order_id}`, { status }));
      return ok(`Order #${order.number} is now ${order.status}.`, { order });
    } catch (err) {
      return fail(err);
    }
  },
});
