import { z } from 'zod';
import { compact, fail, ok, toProductSummary } from './format.js';
import { defineTool } from './types.js';

export const listProducts = defineTool({
  name: 'list_products',
  title: 'List products',
  description: 'List store products. Optional search text, status filter and paging.',
  inputSchema: z.object({
    search: z.string().max(100).optional(),
    status: z.enum(['publish', 'draft', 'pending', 'private', 'any']).default('any'),
    page: z.number().int().min(1).max(1000).default(1),
    per_page: z.number().int().min(1).max(50).default(10),
  }),
  handler: async ({ search, status, page, per_page }, { woo }) => {
    try {
      const raw = await woo.get<Record<string, unknown>[]>('/products', compact({
        search,
        status: status === 'any' ? undefined : status,
        page,
        per_page,
      }));
      const products = raw.map(toProductSummary);
      return ok(`Found ${products.length} product(s) on page ${page}.`, { products, page, per_page });
    } catch (err) {
      return fail(err);
    }
  },
});
