import { registerTools, type SdkMcpServer } from '@urumi/shared';
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

export function registerWooTools(server: SdkMcpServer, deps: ToolDeps): void {
  registerTools(server, wooTools, deps);
}
