import type { CallToolResult, McpServer } from '@modelcontextprotocol/server';
import type { z } from 'zod';

export interface ToolResult {
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export interface ToolDefinition<D, S extends z.ZodObject = z.ZodObject> {
  name: string;
  title: string;
  description: string;
  inputSchema: S;
  handler: (args: z.infer<S>, deps: D) => Promise<ToolResult>;
}

/** Keeps each tool's args precisely typed while letting a registry hold them as one type. */
export function defineTool<D, S extends z.ZodObject>(def: ToolDefinition<D, S>): ToolDefinition<D> {
  // The cast is sound: registerTools always parses args with def.inputSchema (the SDK does) before calling the handler.
  return def as unknown as ToolDefinition<D>;
}

/** Thin adapter (ADR-007): the SDK validates input with the zod schema, then calls the handler. */
export function registerTools<D>(server: McpServer, tools: readonly ToolDefinition<D>[], deps: D): void {
  for (const t of tools) {
    server.registerTool(
      t.name,
      { title: t.title, description: t.description, inputSchema: t.inputSchema },
      async (args) => (await t.handler(args, deps)) as CallToolResult,
    );
  }
}

export function ok(summary: string, data: Record<string, unknown>): ToolResult {
  return {
    // Compact JSON: every character here is sent to the model (token budget, Groq 8K TPM).
    content: [{ type: 'text', text: `${summary}\n${JSON.stringify(data)}` }],
    structuredContent: data,
  };
}

/** Tool-level failure: the model sees the text. */
export function toolError(text: string): ToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}
