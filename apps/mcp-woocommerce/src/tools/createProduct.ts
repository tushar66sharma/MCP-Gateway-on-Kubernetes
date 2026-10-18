import { z } from 'zod';
import { fail, ok, toProductSummary } from './format.js';
import { defineTool } from './types.js';

const PRICE = /^\d+(\.\d{1,2})?$/;

/**
 * A string or a JSON number (LLMs and the Inspector send numbers). Non-negative, at most 2 decimals.
 * Numbers are checked via String(n) first, so float artefacts (0.1 + 0.2) are rejected rather than
 * rounded; only then is the value normalised with toFixed(2). WooCommerce takes prices as strings.
 */
const price = z
  .union([z.string(), z.number()])
  .refine((v) => (typeof v === 'number' ? Number.isFinite(v) && PRICE.test(String(v)) : PRICE.test(v)), {
    message: 'regular_price must be non-negative with at most 2 decimals, like "12", "12.50" or 12.5',
  })
  .transform((v) => (typeof v === 'number' ? v.toFixed(2) : v));

export const createProduct = defineTool({
  name: 'create_product',
  title: 'Create product',
  description: 'Create a simple product with a name and regular price (e.g. "12.50"). Published by default.',
  inputSchema: z.object({
    name: z.string().min(1).max(200),
    regular_price: price,
    description: z.string().max(2000).optional(),
    status: z.enum(['publish', 'draft']).default('publish'),
  }),
  handler: async ({ name, regular_price, description, status }, { woo }) => {
    try {
      const raw = await woo.post<Record<string, unknown>>('/products', {
        name, type: 'simple', regular_price, description, status,
      });
      const product = toProductSummary(raw);
      return ok(`Created product #${product.id} "${product.name}" (${product.status}): ${product.permalink}`, { product });
    } catch (err) {
      return fail(err);
    }
  },
});
