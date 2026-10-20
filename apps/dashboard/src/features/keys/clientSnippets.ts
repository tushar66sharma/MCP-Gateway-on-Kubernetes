export interface ClientSnippets {
  claudeCode: string;
  cursor: string;
  inspector: string;
}

/** Ready-to-paste client setups for a gateway URL and an API key. The key appears once in each. */
export function clientSnippets(mcpUrl: string, key: string): ClientSnippets {
  const header = `Authorization: Bearer ${key}`;
  return {
    claudeCode: `claude mcp add --transport http urumi-gateway ${mcpUrl} --header "${header}"`,
    cursor: JSON.stringify({ mcpServers: { 'urumi-gateway': { url: mcpUrl, headers: { Authorization: `Bearer ${key}` } } } }, null, 2),
    inspector: `npx -y @modelcontextprotocol/inspector@2.11.0 --cli ${mcpUrl} --transport http --header "${header}" --method tools/list`,
  };
}
