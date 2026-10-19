import type { z } from 'zod';
import { defineTool as sharedDefineTool, type ToolDefinition as SharedToolDefinition, type ToolResult } from '@urumi/shared';
import type { WooApi } from '../woo/client.js';

export interface ToolDeps {
  woo: WooApi;
  storeTimeZone: string;
  now: () => Date;
}

export type { ToolResult };

export type ToolDefinition<S extends z.ZodObject = z.ZodObject> = SharedToolDefinition<ToolDeps, S>;

/** Keeps each tool's args precisely typed while letting the registry hold them as one type. */
export function defineTool<S extends z.ZodObject>(def: ToolDefinition<S>): ToolDefinition {
  return sharedDefineTool<ToolDeps, S>(def);
}
