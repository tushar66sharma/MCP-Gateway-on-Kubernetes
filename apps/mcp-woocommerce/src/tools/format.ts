import { WooApiError } from '../woo/errors.js';
import { ok, type ToolResult } from '@urumi/shared';

/** Upper bound for WooCommerce ids. Explicit, so zod does not emit `maximum: 9007199254740991` to the model. */
export const MAX_ID = 2_147_483_647;

export { ok };

/** Tool-level failure: the model sees the text. Never includes stack traces. */
export function fail(err: unknown): ToolResult {
  let text: string;
  if (err instanceof WooApiError) {
    text = err.status > 0
      ? `WooCommerce returned ${err.status}: ${err.message}`
      : `WooCommerce request failed (${err.code}): ${err.message}`;
  } else {
    text = `Unexpected error: ${err instanceof Error ? err.message : String(err)}`;
  }
  return { content: [{ type: 'text', text }], isError: true };
}

const str = (v: unknown): string => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v));

export interface ProductSummary {
  id: number; name: string; status: string; price: string; regular_price: string; stock_status: string; permalink: string;
}
export interface OrderSummary {
  id: number; number: string; status: string; currency: string; total: string;
  date_created_gmt: string; customer: string; item_count: number;
}
export interface OrderDetail extends OrderSummary {
  billing_email: string; payment_method_title: string; date_paid_gmt: string | null;
  line_items: { name: string; quantity: number; total: string }[];
}

type Raw = Record<string, unknown>;

export function toProductSummary(p: Raw): ProductSummary {
  return {
    id: Number(p.id), name: str(p.name), status: str(p.status), price: str(p.price),
    regular_price: str(p.regular_price), stock_status: str(p.stock_status), permalink: str(p.permalink),
  };
}

function lineItems(o: Raw): Raw[] {
  return Array.isArray(o.line_items) ? (o.line_items as Raw[]) : [];
}

export function toOrderSummary(o: Raw): OrderSummary {
  const billing = (o.billing ?? {}) as Raw;
  return {
    id: Number(o.id), number: str(o.number), status: str(o.status), currency: str(o.currency), total: str(o.total),
    date_created_gmt: str(o.date_created_gmt),
    customer: `${str(billing.first_name)} ${str(billing.last_name)}`.trim(),
    item_count: lineItems(o).reduce((n, li) => n + (Number(li.quantity) || 0), 0),
  };
}

export function toOrderDetail(o: Raw): OrderDetail {
  const billing = (o.billing ?? {}) as Raw;
  return {
    ...toOrderSummary(o),
    billing_email: str(billing.email),
    payment_method_title: str(o.payment_method_title),
    date_paid_gmt: typeof o.date_paid_gmt === 'string' ? o.date_paid_gmt : null,
    line_items: lineItems(o).map((li) => ({ name: str(li.name), quantity: Number(li.quantity) || 0, total: str(li.total) })),
  };
}

/** Drops undefined values so optional filters are omitted from the request entirely. */
export function compact<T extends Record<string, string | number | boolean | undefined>>(q: T): Record<string, string | number | boolean> {
  return Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined)) as Record<string, string | number | boolean>;
}
