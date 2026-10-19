# MCP Gateway on Kubernetes

A WooCommerce store running on Kubernetes, paired with a team MCP gateway. Platform admins register MCP servers once; team members then use all of their tools through a single gateway endpoint and a dashboard chat agent. The whole platform is deployed with one Helm chart to a local k3d cluster or a single-node k3s VPS.

> **Status: under construction (the store, three MCP servers and the team MCP gateway run on Kubernetes; the dashboard and chat agent are not built yet, Phase 4).** See the [implementation plan](docs/superpowers/plans/2026-10-18-mcp-gateway-implementation-plan.md) for the current phase status, and the [design spec](docs/superpowers/specs/2026-10-18-mcp-gateway-design.md).

## 1. Project Name and Overview

*(written in Phase 6)*

## 2. Problem Being Solved and Motivation

*(written in Phase 6)*

## 3. Key Features and User Capabilities

*(the full section is written in Phase 6; what works today:)*

- **A WooCommerce store on Kubernetes** at <http://store.localhost>: shop, cart, Cash-on-delivery checkout, customer accounts, admin. One command starts it ([run guide](docs/run-guide.md)).
- **A WooCommerce MCP server** (Phase 2, internal to the cluster): six tools an AI client can call to list and create products and to list, read and update orders. It uses stateless MCP over HTTP with a bearer token, and talks to the store through signed REST calls with a least-privilege `urumi-mcp` shop-manager key. Not reachable from outside the cluster; the gateway fronts it. How to run and explore it with MCP Inspector: [run guide, section 8](docs/run-guide.md#8-woocommerce-mcp-server-phase-2). How the protocol works, with real captured requests: [docs/learning/02-mcp-protocol.md](docs/learning/02-mcp-protocol.md).
- **Two more MCP servers** (Phase 3, internal): `mcp-notes` (five tools, notes kept in memory, bearer token) and `mcp-utilities` (four tools: date ranges, current time and a safe calculator, custom header key).
- **The team MCP gateway** (Phase 3): one endpoint, <http://app.localhost/mcp>, that aggregates the 15 tools of the three MCP servers (named `woo__...`, `notes__...`, `utils__...`). It has its own Postgres database with users, personal API keys (shown once, hashed, revocable at once), invite links, a server registry with health checks (a dead server only loses its own tools; measured: tools gone within 4-12 s, back within 16 s), AES-GCM encrypted upstream credentials, an SSRF guard, and an audit log of every tool call and every rejected credential. It is driven through the REST API at <http://app.localhost/api> (PowerShell examples in the [run guide](docs/run-guide.md#9-the-gateway-phase-3)); MCP Inspector works against it, Claude Code and Cursor snippets are in the run guide but **not tested**. How it works, with real captured traffic: [docs/learning/03-gateway.md](docs/learning/03-gateway.md). Design, security and failure handling: [system-design.md](docs/system-design.md), [security.md](docs/security.md) (partial), [error-handling.md](docs/error-handling.md).
- **Not built yet (Phase 4):** the dashboard web page, the chat agent and the LLM integration.

## 4. Main Workflows and How the Application Works

*(written in Phase 6)*

## 5. Screenshots or Visual Demonstrations

*(written in Phase 6)*

## 6. System Architecture and Links to Design Documents

*(written in Phase 6)*

## 7. Architecture and Workflow Diagrams

*(written in Phase 6)*

## 8. Technology Stack and Rationale

*(written in Phase 6)*

## 9. Repository Structure

*(written in Phase 6)*

## 10. Prerequisites and Required Software Versions

*(written in Phase 6)*

## 11. Complete Local Installation and Setup

*(the complete guide, including the gateway and dashboard, is written in Phase 6)*

### Quick start (local store)

This works today and installs the WooCommerce store, the three MCP servers and the gateway with its Postgres database (the dashboard and chat agent come in Phase 4). You need Docker Desktop (running), `k3d`, `kubectl` and `helm`; see [docs/deployment.md](docs/deployment.md) for versions and every step explained. From the repository root, in PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\setup-hosts.ps1   # optional, once: hosts entries for Node tools (UAC prompt)
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\up.ps1            # start the cluster, install the store if needed, print the URLs
```

`up.ps1` builds the four images (mcp-woocommerce, mcp-notes, mcp-utilities, gateway) and imports them into the cluster before deploying (so Docker must be running), typically takes about 2-3 minutes the first time (observed on the reference machine; it downloads images and WooCommerce), and prints the store URLs. The admin area is <http://store.localhost/wp-admin> (user `admin`); copy the generated password to your clipboard with:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\get-admin-password.ps1
```

Check the MCP server end to end with `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check-mcp-woocommerce.ps1` (read-only; it lists the 6 tools and calls a few). The check runs a small Node client on your PC, so it needs Node 24 and, once, `npm ci` from the repository root ([run guide, section 2](docs/run-guide.md#2-prerequisites-and-one-time-setup)). It is internal-only, so there is no URL; see the [run guide](docs/run-guide.md#8-woocommerce-mcp-server-phase-2) for exploring it with MCP Inspector.

**The gateway (quick start).** After `up.ps1` the gateway is at <http://app.localhost/api> and <http://app.localhost/mcp>. Check it end to end with `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check-gateway.ps1 -Write` (login, a temporary API key, all 15 tools, the audit log; it prints no secrets and needs Node 24 and `npm ci`). The admin account is `admin@example.com`; copy its password with `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\get-secret.ps1 -Namespace gateway -Name gateway-bootstrap -Key password`. To create your own API key, connect MCP Inspector, invite a teammate or look inside the gateway's Postgres database, follow the [run guide, sections 9 and 10](docs/run-guide.md#9-the-gateway-phase-3). There is no web dashboard yet.

Pause with `scripts\stop.ps1` (keeps your data). The complete beginner guide (daily use, customer accounts, viewing the database, resetting) is the [run guide](docs/run-guide.md).

Something wrong? See [docs/troubleshooting.md](docs/troubleshooting.md). To start over completely: [docs/deployment.md](docs/deployment.md#step-9-uninstall-and-what-is-kept).

## 12. Environment-Variable Configuration

*(written in Phase 6)*

## 13. Obtaining and Configuring Free-Tier AI API Keys

*(written in Phase 6)*

## 14. Database Setup, Migrations, and Initialization

*(written in Phase 6)*

## 15. Development Commands

*(written in Phase 6)*

## 16. Testing Commands and Installation Verification

*(written in Phase 6)*

## 17. Build and Production Execution

*(written in Phase 6)*

## 18. Deployment Instructions

*(written in Phase 6)*

## 19. Security Considerations and Secret Management

*(written in Phase 6)*

## 20. Troubleshooting

*(written in Phase 6)*

## 21. Links to Documentation in `docs/`

See the [documentation map](docs/README.md) for an index of all project documentation.

## 22. Known Limitations, Assumptions, and Future Improvements

*(written in Phase 6)*
