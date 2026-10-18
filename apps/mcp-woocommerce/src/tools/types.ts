import type { z } from 'zod';
import type { WooApi } from '../woo/client.js';

export interface ToolDeps {
  woo: WooApi;
  storeTimeZone: string;
  now: () => Date;
}

export interface ToolResult {
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export interface ToolDefinition<S extends z.ZodObject = z.ZodObject> {
  name: string; // ^[a-z_]{1,40}$
  title: string;
  description: string; // <= ~200 chars
  inputSchema: S;
  handler: (args: z.infer<S>, deps: ToolDeps) => Promise<ToolResult>;
}

/** Keeps each tool's args precisely typed while letting the registry hold them as one type. */
export function defineTool<S extends z.ZodObject>(def: ToolDefinition<S>): ToolDefinition {
  // The cast is sound: the registrar always parses args with def.inputSchema before calling the handler.
  return def as unknown as ToolDefinition;
}
