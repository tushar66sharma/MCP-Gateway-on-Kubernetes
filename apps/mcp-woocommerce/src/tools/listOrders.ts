import { z } from 'zod';
import { PERIODS, resolvePeriod } from '@urumi/shared';
import { compact, fail, ok, toOrderSummary } from './format.js';
import { defineTool } from './types.js';

export const ORDER_STATUSES = ['pending', 'processing', 'on-hold', 'completed', 'cancelled', 'refunded', 'failed'] as const;

// Checked in a refine (not z.iso.datetime) so no long regex `pattern` is sent to the model in the JSON Schema.
const ISO_WITH_OFFSET = /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d{1,9})?)?([zZ]|[+-]\d\d:\d\d)$/;
const dateTime = z
  .string()
  .refine((s) => ISO_WITH_OFFSET.test(s) && !Number.isNaN(Date.parse(s)), {
    message: 'Use an ISO 8601 date-time with offset, e.g. 2026-10-18T00:00:00+05:30',
  })
  .describe('ISO 8601 date-time with offset, e.g. 2026-10-18T00:00:00+05:30');

/**
 * WooCommerce bound for `dates_are_gmt=true`: the UTC wall time WITHOUT `Z` or an offset.
 * WP_Date_Query converts any string with a zone into SITE-LOCAL time but then compares it with the
 * GMT column (post_date_gmt / date_created_gmt), which shifted every window by the store's UTC offset.
 * A naive string is read as-is, so the GMT value is compared with the GMT column.
 */
export function toWooGmt(iso: string): string {
  return new Date(iso).toISOString().slice(0, 19);
}

export const listOrders = defineTool({
  name: 'list_orders',
  title: 'List orders',
  description: 'List orders, newest first. Use period=today|yesterday|last_7_days (store time zone) or after/before date-times with offset.',
  inputSchema: z
    .object({
      period: z.enum(PERIODS as [string, ...string[]]).optional(),
      after: dateTime.optional(),
      before: dateTime.optional(),
      status: z.enum([...ORDER_STATUSES, 'any']).default('any'),
      page: z.number().int().min(1).max(1000).default(1),
      per_page: z.number().int().min(1).max(50).default(10),
    })
    .refine((a) => a.period === undefined || (a.after === undefined && a.before === undefined), {
      message: 'Use either period or after/before, not both',
    }),
  handler: async ({ period, after, before, status, page, per_page }, { woo, storeTimeZone, now }) => {
    try {
      // `range` tells the model the actual UTC window, as ISO strings with Z.
      let range: { after?: string; before?: string; timeZone?: string } | undefined;
      if (period !== undefined) {
        const r = resolvePeriod(period as (typeof PERIODS)[number], storeTimeZone, now());
        range = { ...r, timeZone: storeTimeZone };
      } else if (after !== undefined || before !== undefined) {
        range = {};
        if (after !== undefined) range.after = new Date(after).toISOString();
        if (before !== undefined) range.before = new Date(before).toISOString();
      }
      const raw = await woo.get<Record<string, unknown>[]>('/orders', compact({
        after: range?.after === undefined ? undefined : toWooGmt(range.after),
        before: range?.before === undefined ? undefined : toWooGmt(range.before),
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
