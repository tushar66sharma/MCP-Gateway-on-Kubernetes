# mcp-notes

A small MCP server that keeps short text notes. It is one of the upstream servers the Phase 3 gateway aggregates (tools appear there as `notes__<tool>`). It exposes `POST /mcp` plus `/healthz` and `/readyz`. The Helm chart deploys it in namespace `mcp` (internal only).

**Notes are kept in memory only: a restart clears all of them.**

## Tools

| Tool | Input | Result |
|---|---|---|
| `create_note` | `title` (1-200 chars), `content` (1-2000 chars) | `{ note }`; when 500 notes are stored, an error: `Note limit reached (500); delete some notes first.` |
| `list_notes` | `limit?` (1-50, default 20) | `{ notes, count }`, newest first |
| `search_notes` | `query` (1-100 chars), `limit?` (1-50, default 20) | `{ notes, count }`; case-insensitive match on title or text, newest first |
| `delete_note` | `id` (1-2147483647) | `{ deleted: true, id }`; unknown id gives `Note <id> not found.` |
| `ping` | none | `{ ok: true, server: 'mcp-notes', time }` |

A note is `{ id, title, content, createdAt }`; ids start at 1 and are never reused.

## Authentication

`Authorization: Bearer <MCP_AUTH_TOKEN>`. A missing or wrong token gets HTTP 401.

## Configuration (environment variables)

A missing or invalid variable stops the process at start with a message listing variable **names** only.

| Variable | Required | Default | Meaning |
|---|---|---|---|
| `MCP_AUTH_TOKEN` | yes | | Bearer token, at least 16 characters. |
| `PORT` | no | `3002` | Listen port. |
| `LOG_LEVEL` | no | `info` | pino log level. |
| `MCP_ALLOWED_HOSTS` | no | `localhost,127.0.0.1` | Comma-separated Host header allow-list. |

## Development

```
npm test -w @urumi/mcp-notes
npm run build -w @urumi/mcp-notes
```

## Limits

500 notes at most; title 200 and text 2000 characters. The store is a process-local array: no persistence and no sharing between replicas.
