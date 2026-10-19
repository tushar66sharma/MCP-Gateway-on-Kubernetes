import { McpServer, type Tool } from '@modelcontextprotocol/server';
import { mcpRequestLocals } from '@urumi/shared';
import type { GatewayDeps } from '../server.js';
import type { GatewayTool } from '../upstreams/manager.js';
import { GATEWAY_VERSION } from '../version.js';
import type { McpAuth } from './auth.js';

/** The wire shape of one aggregated tool: the gateway's internal routing fields are left out. */
function toWireTool(t: GatewayTool): Tool {
  const tool: Record<string, unknown> = { name: t.name, description: t.description ?? '', inputSchema: t.inputSchema };
  if (t.title !== undefined) tool.title = t.title;
  if (t.outputSchema !== undefined) tool.outputSchema = t.outputSchema;
  if (t.annotations !== undefined) tool.annotations = t.annotations;
  // The schemas are the upstream's own JSON Schemas, passed through unchanged (spec §6.4); the SDK's
  // Tool type narrows `inputSchema` to `{ type: 'object', … }`, which an MCP upstream already satisfies.
  return tool as Tool;
}

/**
 * One McpServer per /mcp request (createMcpHandler calls the factory), with raw handlers on `mcp.server`
 * as in ADR-007 snippet 4: no SDK input validation, the upstream result passed through unchanged, and
 * `projectCallToolResult` applying the negotiated era's wire projection.
 */
export function createGatewayMcpServer(deps: GatewayDeps): () => McpServer {
  return () => {
    const mcp = new McpServer({ name: 'urumi-gateway', version: GATEWAY_VERSION }, { capabilities: { tools: {} } });

    // The cached catalog of every enabled and connected upstream: no I/O (ADR-014).
    mcp.server.setRequestHandler('tools/list', () => ({ tools: deps.upstreams.listTools().map(toWireTool) }));

    mcp.server.setRequestHandler('tools/call', async (request, ctx) => {
      const auth = mcpRequestLocals.getStore()?.auth as McpAuth | undefined;
      // The auth middleware always runs before the MCP handler; reaching here without it is a wiring bug.
      if (!auth) throw new Error('tools/call reached without /mcp authentication');
      const { name, arguments: args } = request.params;
      // Only for its outputSchema; an O(1) index lookup, not a sort of the whole catalog.
      const tool = deps.upstreams.findTool(name);
      // SDK 2.3.1: BaseContext.mcpReq.signal aborts when the client cancels the request.
      const result = await deps.upstreams.callTool(name, args ?? {}, { userId: auth.user.id, apiKeyId: auth.apiKeyId, source: auth.source }, ctx.mcpReq.signal);
      return mcp.server.projectCallToolResult(result, tool?.outputSchema);
    });

    return mcp;
  };
}
