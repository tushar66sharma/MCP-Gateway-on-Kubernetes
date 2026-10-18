# MCP Gateway on Kubernetes

A WooCommerce store running on Kubernetes, paired with a team MCP gateway. Platform admins register MCP servers once; team members then use all of their tools through a single gateway endpoint and a dashboard chat agent. The whole platform is deployed with one Helm chart to a local k3d cluster or a single-node k3s VPS.

> **Status: under construction (the store runs on Kubernetes; the gateway is not built yet).** See the [implementation plan](docs/superpowers/plans/2026-10-18-mcp-gateway-implementation-plan.md) for the current phase status, and the [design spec](docs/superpowers/specs/2026-10-18-mcp-gateway-design.md).

## 1. Project Name and Overview

*(written in Phase 6)*

## 2. Problem Being Solved and Motivation

*(written in Phase 6)*

## 3. Key Features and User Capabilities

*(written in Phase 6)*

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

This works today and installs the WooCommerce store only (the gateway, dashboard and MCP servers come in later phases). You need Docker Desktop (running), `k3d`, `kubectl` and `helm`; see [docs/deployment.md](docs/deployment.md) for versions and every step explained. From the repository root, in PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\setup-hosts.ps1   # optional, once: hosts entries for Node tools (UAC prompt)
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\up.ps1            # start the cluster, install the store if needed, print the URLs
```

`up.ps1` takes about 2-3 minutes the first time (it downloads images and WooCommerce) and prints the store URLs. The admin area is <http://store.localhost/wp-admin> (user `admin`); copy the generated password to your clipboard with:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\get-admin-password.ps1
```

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
