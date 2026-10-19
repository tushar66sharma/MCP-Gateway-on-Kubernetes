# mcp-utilities

A small stateless MCP server with date and time helpers and a safe calculator. It is one of the upstream servers the Phase 3 gateway aggregates (tools appear there as `utils__<tool>`). It exposes `POST /mcp` plus `/healthz` and `/readyz`. The Helm chart deploys it in namespace `mcp` (internal only).

## Tools

| Tool | Input | Result |
|---|---|---|
| `date_range` | `preset` (`today`, `yesterday`, `last_7_days`), `timezone?` (1-64 chars, IANA) | `{ preset, timezone, after, before }` as UTC ISO strings; an unknown zone gives `Unknown time zone: <tz>` |
| `current_time` | `timezone?` | `{ utc, timezone, local: 'YYYY-MM-DD HH:mm:ss', offset: '+05:30' }` |
| `calculate` | `expression` (1-200 chars) | `{ expression, result }`; failures give `Cannot evaluate: <reason>` |
| `ping` | none | `{ ok: true, server: 'mcp-utilities', time }` |

When `timezone` is omitted, `DEFAULT_TIMEZONE` is used.

### Calculator

Operators `+ - * / % ^`, unary minus, parentheses and decimals. `^` is right-associative and `-2^2` is `-4`. It is a hand-written recursive-descent parser: there is no `eval`, `Function` or `vm`. Results are rounded to 12 significant digits (`0.1+0.2` is `0.3`). Errors: `division by zero` (for `/` and `%`), `unexpected character 'x' at position n`, `unexpected end of expression`, `result is not a finite number`, `too deeply nested` (see Limits).

### Limits

- **Expression length:** at most 200 characters (longer input is rejected by the tool's input schema).
- **Nesting depth:** at most 50 levels. Each parenthesis, each unary minus and each `^` counts one level, so a chain of more than 50 `^` (for example `2^2^2^…`) also fails with `too deeply nested`.
- **Precision:** results go through `toPrecision(12)`, so an integer with more than 12 digits is rounded: `123456789012345` comes back as `123456789012000`.

## Authentication

Header `x-utilities-key: <UTILITIES_KEY>`. A missing or wrong key gets HTTP 401.

## Configuration (environment variables)

A missing or invalid variable stops the process at start with a message listing variable **names** only.

| Variable | Required | Default | Meaning |
|---|---|---|---|
| `UTILITIES_KEY` | yes | | Shared key, at least 16 characters. |
| `DEFAULT_TIMEZONE` | no | `UTC` | IANA zone used when a tool call gives none. |
| `PORT` | no | `3003` | Listen port. |
| `LOG_LEVEL` | no | `info` | pino log level. |
| `MCP_ALLOWED_HOSTS` | no | `localhost,127.0.0.1` | Comma-separated Host header allow-list. |

## Development

```
npm test -w @urumi/mcp-utilities
npm run build -w @urumi/mcp-utilities
```
