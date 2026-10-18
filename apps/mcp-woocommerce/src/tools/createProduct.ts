import { z } from 'zod';
import { fail, ok, toProductSummary } from './format.js';
import { defineTool } from './types.js';

export const createProduct = defineTool({
  name: 'create_product',
  title: 'Create product',
  description: 'Create a simple product with a name and regular price (e.g. "12.50"). Published by default.',
  inputSchema: z.object({
    name: z.string().min(1).max(200),
    regular_price: z.string().regex(/^\d+(\.\d{1,2})?$/, 'regular_price must look like "12" or "12.50"'),
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
