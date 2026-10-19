/** Server slug (spec §6.4, ADR-006): lowercase, starts with a letter, 2–16 characters, no '_'. */
export const SLUG_RE = /^[a-z][a-z0-9-]{1,15}$/;
/** What MCP clients accept as a tool name; every gateway tool name must match. */
export const TOOL_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;
export const TOOL_SEP = '__';

/** `<slug>__<tool>`, or null when the result breaks TOOL_NAME_RE (that tool is then skipped). */
export function toGatewayToolName(slug: string, tool: string): string | null {
  const name = `${slug}${TOOL_SEP}${tool}`;
  return TOOL_NAME_RE.test(name) ? name : null;
}

/**
 * Splits on the FIRST separator. A slug can never contain '_', so the first '__' always ends the slug,
 * and the tool part may itself contain '__'.
 */
export function parseGatewayToolName(name: string): { slug: string; tool: string } | null {
  const at = name.indexOf(TOOL_SEP);
  if (at <= 0) return null;
  const tool = name.slice(at + TOOL_SEP.length);
  if (tool.length === 0) return null;
  return { slug: name.slice(0, at), tool };
}
