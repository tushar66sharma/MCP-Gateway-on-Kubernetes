# ADR-001: TypeScript npm-workspaces monorepo

## Status

Accepted

## Date

2026-10-18

## Context

The project has five deployable pieces: the dashboard (`apps/dashboard`), the gateway (`apps/gateway`) and three MCP servers (`apps/mcp-woocommerce`, `apps/mcp-notes`, `apps/mcp-utilities`). The four Node services need the same plumbing: a logger, an env-config loader, an MCP HTTP server bootstrap, `/healthz` and `/readyz` endpoints, and upstream auth middleware. The assignment has a 4-day budget, so the setup cost of the repository structure matters.

## Decision

We use one repository and one language, TypeScript, organised as an **npm workspaces monorepo**: one root `package.json`, one lockfile and a shared TypeScript config. The apps live in `apps/*`. Common code lives in `packages/shared` and is imported by the Node services. The Helm chart (`charts/urumi-platform`) lives in the same repository.

## Alternatives considered

- **One repository per service.** Rejected: the shared plumbing would have to be published as a package or copied between repos, and a single change (for example to the health-endpoint contract) would need several coordinated pull requests. The Helm chart deploys all services together anyway.
- **Another workspace tool (pnpm, Turborepo, Nx).** Not chosen: these add tooling to learn and configure without solving a problem we have. npm ships with Node 24, which all our images use.
- **Copy-pasting shared code into each app.** Rejected: duplication guarantees the apps drift apart (for example in how they validate upstream credentials).

## Consequences/trade-offs

- One `npm ci` installs everything, and one lockfile keeps dependency versions consistent across services.
- Type-safe sharing: a change to the shared MCP bootstrap is checked by the compiler in every service.
- Docker builds must be careful about the build context (each image needs the root lockfile and `packages/shared`), which makes the multi-stage Dockerfiles slightly more involved than for isolated repos.
- npm workspaces provide no build caching or task graph; with five packages this is acceptable.
- The repository structure is a decision here; the workspaces and packages are created in later phases.

## Revisit if

- Build or CI time becomes a real problem (then evaluate a task-runner with caching).
- A service needs a different language or release cadence, which would justify splitting it out.
