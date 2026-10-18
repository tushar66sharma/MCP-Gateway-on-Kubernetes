import { z } from 'zod';
import { PERIODS, resolvePeriod } from '../woo/period.js';
import { compact, fail, ok, toOrderSummary } from './format.js';
import { defineTool } from './types.js';

export const ORDER_STATUSES = ['pending', 'processing', 'on-hold', 'completed', 'cancelled', 'refunded', 'failed'] as const;

export const listOrders = defineTool({
  name: 'list_orders',
  title: 'List orders',
  description: 'List orders, newest first. Use period=today|yesterday|last_7_days (store time zone) or after/before ISO times.',
  inputSchema: z
    .object({
      period: z.enum(PERIODS as [string, ...string[]]).optional(),
      after: z.iso.datetime({ offset: true }).optional(),
      before: z.iso.datetime({ offset: true }).optional(),
      status: z.enum([...ORDER_STATUSES, 'any']).default('any'),
      page: z.number().int().min(1).default(1),
      per_page: z.number().int().min(1).max(50).default(20),
    })
    .refine((a) => a.period === undefined || (a.after === undefined && a.before === undefined), {
      message: 'Use either period or after/before, not both',
    }),
  handler: async ({ period, after, before, status, page, per_page }, { woo, storeTimeZone, now }) => {
    try {
      let range: { after: string; before: string; timeZone: string } | undefined;
      let lo = after;
      let hi = before;
      if (period !== undefined) {
        const r = resolvePeriod(period as (typeof PERIODS)[number], storeTimeZone, now());
        range = { ...r, timeZone: storeTimeZone };
        lo = r.after;
        hi = r.before;
      }
      const raw = await woo.get<Record<string, unknown>[]>('/orders', compact({
        after: lo,
        before: hi,
        dates_are_gmt: true,
        status: status === 'any' ? undefined : status,
        page,
        per_page,
        orderby: 'date',
        order: 'desc',
      }));
      const orders = raw.map(toOrderSummary);
      return ok(`Found ${orders.length} order(s) on page ${page}.`, {
        orders, ...(range ? { range } : {}), page, per_page,
      });
    } catch (err) {
      return fail(err);
    }
  },
});
