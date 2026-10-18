import type { CallToolResult } from '@modelcontextprotocol/server';
import type { SdkMcpServer } from '@urumi/shared';
import { createProduct } from './createProduct.js';
import { getOrder } from './getOrder.js';
import { listOrders } from './listOrders.js';
import { listProducts } from './listProducts.js';
import { ping } from './ping.js';
import type { ToolDefinition, ToolDeps } from './types.js';
import { updateOrderStatus } from './updateOrderStatus.js';

export const wooTools: readonly ToolDefinition[] = [
  listProducts, createProduct, listOrders, getOrder, updateOrderStatus, ping,
];

/** Thin adapter (ADR-007): the SDK validates input with the zod schema, then calls the handler. */
export function registerWooTools(server: SdkMcpServer, deps: ToolDeps): void {
  for (const t of wooTools) {
    server.registerTool(
      t.name,
      { title: t.title, description: t.description, inputSchema: t.inputSchema },
      async (args) => (await t.handler(args, deps)) as CallToolResult,
    );
  }
}
