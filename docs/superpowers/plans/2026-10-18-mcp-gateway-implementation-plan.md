# MCP Gateway on Kubernetes — Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a WooCommerce store, a self-written WooCommerce MCP server, two extra upstream MCP servers, a team MCP gateway with a React dashboard, and an LLM chat agent. All of it runs on k3d via one Helm chart, and the same chart is deployable to k3s with different values.

**Architecture:** See the approved spec, [`docs/superpowers/specs/2026-10-18-mcp-gateway-design.md`](../specs/2026-10-18-mcp-gateway-design.md).
- An npm-workspaces TypeScript monorepo (`apps/*`, `packages/shared`) and one Helm chart (`charts/urumi-platform`) that creates three namespaces (`store`, `mcp`, `gateway`).
- The gateway is both an MCP client (to every upstream) and an MCP server (`/mcp`). It keeps a cached, health-checked tool catalog, prefixes tool names with `<slug>__`, and stores users, hashed keys, encrypted upstream credentials and audit logs in Postgres.

**Tech Stack:** Node 24, TypeScript 5, Express 5, MCP TypeScript SDK (v2 `@modelcontextprotocol/server`/`client` 2.3.x, with v1 `@modelcontextprotocol/sdk` 1.32.x as fallback), zod, Drizzle ORM + `pg` (PGlite in tests), argon2, pino, Vitest, React 19 + Vite + Tailwind + Radix UI + TanStack Query, Playwright, Docker Desktop, k3d 5.9 (k3s + Traefik), Helm 4, WordPress + WooCommerce + MariaDB, Postgres, Groq / OpenRouter (OpenAI-compatible).

## How this plan is organised (read first)

- **Phase 0** is written at full step-by-step detail: exact commands and file contents.
- **Phases 1–6** are written at task level: files, interfaces, tests, verification commands, commit messages and exit criteria.
- At the **start of each phase**, before any code, a detailed phase plan with full code steps is written to `docs/superpowers/plans/2026-10-xx-phase-N-<name>.md`. It follows the TDD step format and must keep the interfaces fixed here.
  - **Why:** Phases 2–4 depend on spike results (MCP SDK v2 vs v1, WooCommerce OAuth1 behavior, Groq model choice). Writing exact code for them today would mean guessing at APIs.
- If a spike changes an interface listed here, update this file *and* the spec in the same commit, and record the reason in the matching ADR.

## Global Constraints

- **Git:**
  - Each phase starts with `git switch -c <phase-branch>` from the previous phase's branch (Phase 0 branched from `main`).
  - Commit after every task, often several times per task.
  - **Never `git push`.** The user pushes.
  - **No `Co-Authored-By` or any Claude/AI attribution in commit messages.**
  - Conventional commit prefixes: `feat:`, `fix:`, `test:`, `docs:`, `chore:`, `build:`, `ci:`, `refactor:`.
- **Project root:** `C:\Users\Lenovo\Desktop\MCP Gateway on Kubernetes\MCP-Gateway-on-Kubernetes`. Everything lives inside it.
- **Secrets:** never in source, values files, or git. `.env` is git-ignored; `.env.example` holds placeholders only. LLM keys reach the cluster via `scripts/create-secrets.ps1` → Secret `llm-api-keys`.
- **No Gemini** API or keys anywhere.
- **Line endings:** LF for everything except `*.ps1` (CRLF), per `.gitattributes`. Shell scripts executed inside containers break with CRLF.
- **Node:** `>=24` (`engines` field). TypeScript `strict: true`. ES modules (`"type": "module"`).
- **Tool names** exposed by the gateway match `^[a-zA-Z0-9_-]{1,64}$`. Slugs match `^[a-z][a-z0-9-]{1,15}$`. The separator is `__`.
- **Timeouts:** upstream health check 5000 ms every 15000 ms; upstream tool call 20000 ms; WooCommerce HTTP 10000 ms; LLM request 30000 ms; chat turn 60000 ms; max 8 agent steps; tool result truncated to 6000 chars for the LLM.
- **API keys:** `ugw_` + 32 random bytes base62; stored as SHA-256 hex; display prefix = first 12 chars.
- **Every Kubernetes workload:** readiness + liveness probes, requests + limits, `runAsNonRoot: true` with explicit `runAsUser`/`runAsGroup`/`fsGroup` (**no exceptions**: MariaDB runs as uid/gid 999, WordPress and the setup Job as uid/gid 33 with sysctl `net.ipv4.ip_unprivileged_port_start=0`; see spec §8.5 and ADR-004), `allowPrivilegeEscalation: false`, `capabilities.drop: [ALL]`, `seccompProfile: RuntimeDefault`, `automountServiceAccountToken: false`. `readOnlyRootFilesystem` is not required for MariaDB/WordPress/WP-CLI.
- **Hosts:** `store.localhost`, `app.localhost` (local). Ingress class `traefik`.
- **Docs:** every task that changes behavior updates the relevant `docs/` file in the same commit (CLAUDE.md §1). Docs never describe unimplemented behavior as done; planned items are marked **(planned)**.
- **Done** means verified by running a command and seeing its output. Never claim success without evidence.

## Timeline and branches

| Phase | Branch | Target | Exit criterion (the user runs it) |
|---|---|---|---|
| 0 Setup, scaffolding, K8s primer | `phase-0-setup-and-planning` | Day 1 AM | `kubectl get nodes` shows Ready; `http://hello.localhost` answers through Traefik after `kubectl apply -f deploy/examples/hello.yaml` (the example is deleted after verification); repo scaffold + ADRs committed |
| 1 Store on Kubernetes | `phase-1-store` | Day 1 PM | Checkout with COD at `http://store.localhost`, order visible in wp-admin, data survives `kubectl delete pod` |
| 2 WooCommerce MCP server | `phase-2-woocommerce-mcp` | Day 2 AM | MCP Inspector (via port-forward) lists 6 tools and creates a product that shows on the storefront |
| 3 Gateway core + upstreams | `phase-3-gateway` | Day 2 PM → Day 3 AM | Inspector at `http://app.localhost/mcp` with an API key lists all prefixed tools; revoke / disable / kill-pod behave as specified; audit rows exist |
| 4 Dashboard + chat agent | `phase-4-dashboard-chat` | Day 3 | Every user story works in the UI at desktop and mobile width; chat creates a product and lists today's orders |
| 5 Hardening + prod values | `phase-5-hardening-prod` | Day 4 AM | NetworkPolicy probe matrix passes; `values-prod.yaml` renders and lints; full definition-of-done run with Claude Code as user B |
| 6 Docs + demo prep | `phase-6-docs-demo` | Day 4 PM | README walkthrough works from a fresh clone; all CLAUDE.md docs present and accurate; demo script rehearsed |

---

# Phase 0 — Setup, scaffolding, Kubernetes primer (full detail)

### Task 0.1: Install and configure local tooling

**Files:**
- Create: `%USERPROFILE%\.wslconfig` (outside the repo; the user's machine config)

**Why:** k3d runs Kubernetes nodes as Docker containers. Docker Desktop runs inside WSL2, and without a cap WSL can take most of the 15 GB of RAM. Helm installs our chart. k3d creates the cluster.

- [ ] **Step 1: Cap WSL2 memory.** Create `C:\Users\Lenovo\.wslconfig`:

```ini
[wsl2]
memory=9GB
processors=8
swap=4GB
```

Then run `wsl --shutdown` in PowerShell. This stops WSL; Docker Desktop restarts it.

- [ ] **Step 2: Start Docker Desktop** from the Start menu and wait until the whale icon says "Engine running". Verify:

Run: `docker info --format '{{.ServerVersion}} {{.MemTotal}}'`
Expected: a version string and roughly `9.6e+09` bytes (about 9 GB).

- [ ] **Step 3: Install Helm and k3d with winget.**

Run: `winget install --id Helm.Helm -e` then `winget install --id k3d.k3d -e`
Then **open a new terminal** so PATH refreshes.

- [ ] **Step 4: Verify the tools.**

Run: `helm version --short; k3d version; kubectl version --client`
Expected: `v4.3.x`, `k3d version v5.9.0` with a k3s version line, and kubectl `v1.36.x`.

(No commit: these are machine changes, not repo changes. Record them in `docs/learning/00-setup-log.md` in Task 0.3.)

### Task 0.2: Repository scaffolding

**Files:**
- Create: `.gitignore`, `.gitattributes`, `.editorconfig`, `.nvmrc`, `package.json`, `tsconfig.base.json`, `.env.example`, `README.md` (replace the 1-line stub with a skeleton)

**Interfaces:**
- Produces: npm workspaces `apps/*` and `packages/*`; root scripts `build`, `test`, `lint`, `typecheck` that later phases rely on.

- [ ] **Step 1: Write `.gitattributes`**

```gitattributes
* text=auto eol=lf
*.ps1 text eol=crlf
*.png binary
*.jpg binary
*.pdf binary
```

- [ ] **Step 2: Write `.gitignore`**

```gitignore
node_modules/
dist/
coverage/
.vite/
playwright-report/
test-results/
*.log
.env
.env.*
!.env.example
*.tgz
.DS_Store
.idea/
.vscode/*
!.vscode/extensions.json
kubeconfig*
```

- [ ] **Step 3: Write `.editorconfig` and `.nvmrc`**

```editorconfig
root = true
[*]
charset = utf-8
end_of_line = lf
indent_style = space
indent_size = 2
insert_final_newline = true
trim_trailing_whitespace = true
[*.ps1]
end_of_line = crlf
```

`.nvmrc` contains `24`.

- [ ] **Step 4: Write root `package.json`**

```json
{
  "name": "urumi-mcp-gateway",
  "private": true,
  "type": "module",
  "engines": { "node": ">=24" },
  "workspaces": ["packages/*", "apps/*"],
  "scripts": {
    "build": "npm run build --workspaces --if-present",
    "test": "npm run test --workspaces --if-present",
    "typecheck": "npm run typecheck --workspaces --if-present",
    "lint": "npm run lint --workspaces --if-present"
  }
}
```

- [ ] **Step 5: Write `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

- [ ] **Step 6: Write `.env.example`.** This file is used **only** by `scripts/create-secrets.ps1` and local dev runs; it is never read by Helm.

```dotenv
# ---- LLM providers (chat agent). Get a free key: https://console.groq.com/keys
GROQ_API_KEY=replace-with-your-groq-key
# Optional fallback. Free models: 20 req/min, 50 req/day (1000/day after $10 lifetime credit)
OPENROUTER_API_KEY=
# groq | openrouter
LLM_PROVIDER=groq
# Model id at the chosen provider (decided in Phase 4 spike)
LLM_MODEL=openai/gpt-oss-120b
# Optional: provider to try once when the primary is rate limited / down
LLM_FALLBACK_PROVIDER=

# ---- Optional overrides for the bootstrap admin (otherwise Helm generates a password)
BOOTSTRAP_ADMIN_EMAIL=admin@example.com
BOOTSTRAP_ADMIN_PASSWORD=
```

- [ ] **Step 7: Replace `README.md` with a skeleton.** Include the title, a one-paragraph overview, a "Status: under construction — see docs/superpowers/plans" banner, and empty numbered headings for the 22 sections CLAUDE.md §5 requires. Each empty section says *(written in Phase 6)*.

- [ ] **Step 8: Run `npm install`** (creates `package-lock.json` with no deps yet). Expected: `up to date`.

- [ ] **Step 9: Commit**

```bash
git add .gitignore .gitattributes .editorconfig .nvmrc package.json package-lock.json tsconfig.base.json .env.example README.md
git commit -m "chore: scaffold npm workspaces monorepo with shared TS config and env template"
```

### Task 0.3: Local cluster scripts + hello-world through Ingress

**Files:**
- Create: `scripts/cluster-up.ps1`, `scripts/cluster-down.ps1`, `scripts/setup-hosts.ps1`, `deploy/k3d-config.yaml`, `deploy/examples/hello.yaml`, `docs/learning/00-setup-log.md`, `docs/learning/01-kubernetes-primer.md`

**Interfaces:**
- Produces: cluster name `urumi`; kube context `k3d-urumi`; host ports 80/443 → Traefik; later scripts call `scripts/cluster-up.ps1` idempotently.

- [ ] **Step 1: Write `deploy/k3d-config.yaml`**

```yaml
apiVersion: k3d.io/v1alpha5
kind: Simple
metadata:
  name: urumi
servers: 1
agents: 0
ports:
  - port: 80:80
    nodeFilters: [loadbalancer]
  - port: 443:443
    nodeFilters: [loadbalancer]
options:
  k3s:
    extraArgs: []
```

(Traefik, local-path storage and the kube-router NetworkPolicy controller are enabled by default in k3s, so nothing extra is needed.)

- [ ] **Step 2: Write `scripts/cluster-up.ps1`**

```powershell
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$existing = k3d cluster list -o json | ConvertFrom-Json | Where-Object { $_.name -eq 'urumi' }
if (-not $existing) {
  k3d cluster create --config (Join-Path $root 'deploy/k3d-config.yaml')
} else {
  k3d cluster start urumi
}
kubectl config use-context k3d-urumi
kubectl wait --for=condition=Ready nodes --all --timeout=180s
kubectl -n kube-system rollout status deployment/traefik --timeout=300s
```

`scripts/cluster-down.ps1`: `k3d cluster delete urumi` (this deletes all cluster data; say so in a comment and in the docs).

- [ ] **Step 3: Write `scripts/setup-hosts.ps1`.** It self-elevates and appends `127.0.0.1 store.localhost app.localhost hello.localhost` to the hosts file only if it is missing:

```powershell
$hosts = "$env:WINDIR\System32\drivers\etc\hosts"
$line = '127.0.0.1 store.localhost app.localhost hello.localhost'
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Start-Process powershell -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
  return
}
if (-not (Select-String -Path $hosts -SimpleMatch $line -Quiet)) { Add-Content -Path $hosts -Value "`r`n$line" }
Write-Host 'hosts entries present.'
```

- [ ] **Step 4: Run** `powershell -ExecutionPolicy Bypass -File scripts/cluster-up.ps1`, then `scripts/setup-hosts.ps1` (accept the admin prompt).

Run: `kubectl get nodes; kubectl get pods -A`
Expected: one node `k3d-urumi-server-0` in `Ready`; traefik, coredns, local-path-provisioner and metrics-server `Running`.

- [ ] **Step 5: Write `deploy/examples/hello.yaml`.** It's a teaching example: a Deployment of `traefik/whoami`, a Service, and an Ingress for `hello.localhost` with `ingressClassName: traefik`. Probes and resources are included so it already shows the patterns we will use everywhere.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata: { name: hello, namespace: default }
spec:
  replicas: 1
  selector: { matchLabels: { app: hello } }
  template:
    metadata: { labels: { app: hello } }
    spec:
      containers:
        - name: whoami
          image: traefik/whoami:v1.10
          ports: [{ containerPort: 80 }]
          readinessProbe: { httpGet: { path: /, port: 80 }, periodSeconds: 5 }
          livenessProbe: { httpGet: { path: /, port: 80 }, periodSeconds: 10 }
          resources:
            requests: { cpu: 10m, memory: 16Mi }
            limits: { cpu: 100m, memory: 32Mi }
---
apiVersion: v1
kind: Service
metadata: { name: hello, namespace: default }
spec:
  selector: { app: hello }
  ports: [{ port: 80, targetPort: 80 }]
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata: { name: hello, namespace: default }
spec:
  ingressClassName: traefik
  rules:
    - host: hello.localhost
      http:
        paths:
          - path: /
            pathType: Prefix
            backend: { service: { name: hello, port: { number: 80 } } }
```

- [ ] **Step 6: Apply and verify**

Run: `kubectl apply -f deploy/examples/hello.yaml; kubectl rollout status deploy/hello; curl.exe -s http://hello.localhost`
Expected: whoami output showing `Hostname: hello-...` and `X-Forwarded-For` headers. That proves the full path: browser → host port 80 → k3d load balancer → Traefik → Service → Pod.

Then clean up: `kubectl delete -f deploy/examples/hello.yaml`.

- [ ] **Step 7: Write `docs/learning/01-kubernetes-primer.md`.** It's an interview-prep primer tied to *this* project:
  - Cluster, node, namespace, Pod, Deployment vs StatefulSet, Service (ClusterIP), Ingress + controller (Traefik), PVC/StorageClass (local-path), Secret vs ConfigMap, probes (readiness vs liveness vs startup), requests vs limits, Job and Helm hooks, NetworkPolicy, what Helm is (templates + values → manifests; release; upgrade/rollback).
  - Each concept gets one paragraph and a `kubectl` command to inspect it, plus a "where we use it" pointer.
  - Also the hello-world request path as a Mermaid diagram.

  Write `docs/learning/00-setup-log.md`: what was installed, versions, the `.wslconfig` values and why, the port 8080 conflict, and how to reset (`cluster-down.ps1`).

- [ ] **Step 8: Commit**

```bash
git add deploy/k3d-config.yaml deploy/examples/hello.yaml scripts/cluster-up.ps1 scripts/cluster-down.ps1 scripts/setup-hosts.ps1
git commit -m "chore: add k3d cluster scripts, hosts setup and hello-world ingress example"
git add docs/learning
git commit -m "docs: add Kubernetes primer and setup log for local environment"
```

### Task 0.4: Architecture decision records

**Files:**
- Create: `docs/decisions/README.md` (index plus template), and `docs/decisions/ADR-001` … `ADR-014`

Each ADR uses this template: **Status · Date · Context · Decision · Alternatives considered · Consequences/trade-offs · Revisit if**. Its content comes from the spec section listed.

| ADR | Title | Spec § |
|---|---|---|
| 001 | TypeScript npm-workspaces monorepo | §3 |
| 002 | k3d locally / k3s in prod, Traefik ingress (ingress-nginx retirement) | §8.3 |
| 003 | One Helm chart owning three namespaces, `resource-policy: keep` | §8.1 |
| 004 | Own MariaDB/Postgres templates instead of Bitnami charts | §1, §8 |
| 005 | WooCommerce MCP ↔ store via REST v3 + OAuth1 (vs WP-CLI, SQL, app passwords) | §5.2 |
| 006 | Tool naming `<slug>__<tool>`, immutable slugs, 64-char rule | §6.4 |
| 007 | MCP SDK v2 stateless Streamable HTTP, v1 fallback (to be finalized in Phase 2) | §4 |
| 008 | API keys: random + SHA-256 (not bcrypt), shown once | §6.7 |
| 009 | Upstream credentials AES-256-GCM at rest, key in K8s Secret | §6.6 |
| 010 | Chat agent loops back through the real `/mcp` with a 5-min internal token | §6.9 |
| 011 | LLM: one OpenAI-compatible adapter; Groq primary, OpenRouter fallback; no Gemini | §6.10 |
| 012 | Deployment target is k3s on a VPS, not Vercel/Render (CLAUDE.md §6 conflict), and no VPS was available, so it is documented and render-validated only | §8.8 |
| 013 | Invite links instead of email/temporary passwords | §6.7 |
| 014 | Cached health-checked tool catalog instead of live fan-out on `tools/list` | §6.3 |

- [ ] **Step 1:** Write `docs/decisions/README.md` with the template and the index table.
- [ ] **Step 2:** Write ADR-001 to ADR-014 (each about 25–50 lines).
- [ ] **Step 3: Commit**

```bash
git add docs/decisions
git commit -m "docs: record architecture decisions ADR-001 to ADR-014"
```

### Task 0.5: Documentation skeleton

**Files:**
- Create: `docs/README.md` (documentation map), `docs/architecture.md` (from spec §3, status: target architecture, components marked **(planned)** until built), `docs/diagrams/README.md` (diagram index; diagrams are added as workflows are implemented)

- [ ] **Step 1:** Write the three files.
- [ ] **Step 2: Commit** `docs: add documentation map and target architecture overview`

**Phase 0 exit check (user):** `kubectl get nodes` shows Ready; `git log --oneline` shows the Phase 0 commits; `git status` is clean. Then tell the user: *"Phase 0 is complete on branch `phase-0-setup-and-planning`. Push it when ready."*

---

# Phase 1 — Store on Kubernetes (branch `phase-1-store`)

**Learning focus:** StatefulSet vs Deployment, PVCs, Secrets, Helm templating and `lookup`, Helm hooks and Jobs, Ingress.

### Task 1.1: Chart skeleton, helpers, namespaces, values files
**Files:**
- Create: `charts/urumi-platform/{Chart.yaml,values.yaml,values.schema.json,.helmignore}`, `templates/_helpers.tpl`, `templates/namespaces.yaml`, `templates/NOTES.txt`, `deploy/values-local.yaml`, `deploy/values-prod.yaml` (stub with comments), `scripts/deploy.ps1`

**Interfaces (produces):**
- Helpers: `urumi.labels`, `urumi.selectorLabels`, `urumi.image` (deferred to Task 2.5), `urumi.podSecurityContext`, `urumi.containerSecurityContext`, `urumi.generatedValue` (reuses existing Secret data via `lookup`, else `randAlphaNum`)
- Values keys: `global.{storeHost,appHost,publicScheme,publicPort,ingressClassName,storageClass,imagePullPolicy,tls}` (`global.imageRegistry` and `global.imageTag` deferred to Task 2.5), `namespaces.{store,mcp,gateway}`, plus one block per component.
- `scripts/deploy.ps1` runs `helm upgrade --install urumi charts/urumi-platform -n urumi-system --create-namespace -f deploy/values-local.yaml --wait --timeout 10m`

**Verify:** `helm lint charts/urumi-platform -f deploy/values-local.yaml` → `0 chart(s) failed`; `helm template ... | Select-String "kind: Namespace"` shows 3.
**Commit:** `feat(helm): add umbrella chart skeleton with helpers, namespaces and values files`

### Task 1.2: MariaDB StatefulSet
**Files:** `templates/store/mariadb-secret.yaml`, `mariadb-statefulset.yaml`, `mariadb-service.yaml`
- Pin the image tag (check the current LTS on Docker Hub at implementation time; record it in values).
- `volumeClaimTemplates` 2Gi.
- Probes: `healthcheck.sh --connect --innodb_initialized`.
- Resources per spec §8.7.

**Verify:** deploy; `kubectl -n store get sts,pvc,pod` shows Running and a Bound PVC; `kubectl -n store delete pod mariadb-0`, then after recovery a test row written before the delete still exists (the commands go in the phase plan).
**Commit:** `feat(helm): add MariaDB StatefulSet with persistent volume and probes`

### Task 1.3: WordPress Deployment + Ingress
**Files:** `templates/store/wordpress-{pvc,deployment,service,ingress}.yaml`, `templates/store/store-secrets.yaml` (`store-admin`, `store-woo-api`)
- `Recreate` strategy (RWO volume).
- `WORDPRESS_CONFIG_EXTRA` sets `WP_HOME`/`WP_SITEURL` = `{{publicScheme}}://{{storeHost}}`.
- `startupProbe` on `/wp-login.php` (failureThreshold 30 × 10s), then readiness and liveness probes.

**Verify:** `curl.exe -I http://store.localhost/wp-admin/install.php` → 200.
**Commit:** `feat(helm): add WordPress deployment, persistent storage and store ingress`

### Task 1.4: Store setup Job (WP-CLI, idempotent)
**Files:** `templates/store/store-setup-configmap.yaml` (script `setup.sh`), `templates/store/store-setup-job.yaml` (hook `post-install,post-upgrade`, `hook-delete-policy: before-hook-creation`, `backoffLimit: 3`, `activeDeadlineSeconds: 480`)

`setup.sh` steps:
1. Wait for the DB.
2. `wp core is-installed || wp core install`.
3. Install and activate a pinned WooCommerce version.
4. Set `woocommerce_currency=USD`, `timezone_string`, default country.
5. Enable COD: `wp option update woocommerce_cod_settings '{"enabled":"yes",...}' --format=json`.
6. Skip onboarding.
7. `wp rewrite structure '/%postname%/'`.
8. Seed 3 products only if `wp wc product list` is empty (needs a `--user=admin` flag).
9. Upsert the REST key with `wp eval-file /scripts/upsert-api-key.php`. The PHP inserts into `{prefix}woocommerce_api_keys` with `consumer_key = wc_api_hash($ck)`, `consumer_secret = $cs`, `truncated_key = substr($ck,-7)`, `permissions='read_write'`, `user_id` = admin, deleting any row with the same description first.

**Spike inside this task (≤ 45 min):** from a throwaway `curlimages/curl` pod, call `GET http://wordpress.store.svc.cluster.local/wp-json/wc/v3/products` with an OAuth1-signed request (a helper Node one-liner). If the signature fails because of a host mismatch, apply the documented fallback (ADR-005 alternative) and update the ADR.

**Verify:** `kubectl -n store logs job/store-setup` ends with `SETUP COMPLETE`. Re-running `scripts/deploy.ps1` succeeds without duplicate products.
**Commit(s):** `feat(store): automate WordPress/WooCommerce install, COD and REST key via WP-CLI job`, then `docs: record WooCommerce REST auth spike result in ADR-005`

### Task 1.5: Phase 1 docs + manual checkout
- Write `docs/workflows.md` §"Store checkout" (Mermaid sequence), `docs/deployment.md` §"Local (k3d)" first draft, and `docs/troubleshooting.md` entries (port 80, pending PVC, setup Job failures, `kubectl logs`).
- **Verify (user):**
  - Open `http://store.localhost`, add a product to the cart, check out with Cash on Delivery.
  - Log into `http://store.localhost/wp-admin`; the password comes from `kubectl -n store get secret store-admin -o jsonpath="{.data.password}"`, base64-decoded with the PowerShell one-liner in NOTES.txt. The order is listed.
  - `kubectl -n store delete pod -l app.kubernetes.io/name=wordpress`; after restart the order is still there.
- **Commit:** `docs: document store workflow, local deployment and store troubleshooting`

---

# Phase 2 — WooCommerce MCP server (branch `phase-2-woocommerce-mcp`)

**Learning focus:** the MCP lifecycle (initialize/discover → tools/list → tools/call), Streamable HTTP, JSON-RPC, tool input schemas.

### Task 2.1: SDK compatibility gate (spike, ≤ 60 min)
- Build a 30-line `ping` server with v2 `@modelcontextprotocol/server` (stateless Streamable HTTP on Express or Node `http`).
- Test it with `npx @modelcontextprotocol/inspector@2.11.0` (Streamable HTTP, `http://localhost:4000/mcp`) **and** with Claude Code (`claude mcp add --transport http spike http://localhost:4000/mcp`, then ask it to call ping).
- **If both work →** v2. **Else →** v1 `@modelcontextprotocol/sdk@1.32.1` with `sessionIdGenerator: undefined`.
- Also test the v2 *client* against the chosen server (the gateway needs it).
- Record the results, exact package versions and the import paths in **ADR-007** (Status: Accepted). Update spec §4 if v1 wins.
- **Commit:** `docs: finalize MCP SDK choice after client compatibility spike (ADR-007)`

### Task 2.2: `packages/shared`
**Files:** `packages/shared/{package.json,tsconfig.json,vitest.config.ts}`, `src/{index,logger,env,mcpHttpServer,upstreamAuth}.ts`, `test/{env,upstreamAuth,mcpHttpServer}.test.ts`

**Interfaces (produces — later phases depend on these exact names):**
```ts
export function createLogger(name: string): import('pino').Logger;              // JSON logs, redacts authorization, cookie, *key*, *secret*, credential
export function loadEnv<S extends z.ZodTypeAny>(schema: S, env?: NodeJS.ProcessEnv): z.infer<S>; // throws EnvValidationError listing every bad var
export type UpstreamAuth = { kind: 'none' } | { kind: 'bearer'; token: string } | { kind: 'header'; header: string; value: string };
export function upstreamAuthMiddleware(auth: UpstreamAuth): (req, res, next) => void; // timing-safe compare, 401 JSON-RPC error
export interface McpHttpServerOptions { name: string; version: string; port: number; host?: string; auth: UpstreamAuth; logger: Logger;
  allowedHosts: string[];   // hostnames WITHOUT ports; Host check on /mcp only (never the probes)
  registerTools: (server: SdkMcpServer) => void; readinessCheck?: () => Promise<boolean>; }
export function startMcpHttpServer(opts: McpHttpServerOptions): Promise<{ close(): Promise<void>; port: number }>; // POST /mcp, GET /healthz, GET /readyz
```
**As built (Phase 2):** `createLogger(name, level?)`; `SdkMcpServer` is the SDK's `McpServer`; SDK v2 package names are `@modelcontextprotocol/server`, `/client`, `/express` and `/node` (exact versions in ADR-007); `allowedHosts` entries are hostnames only (the SDK ignores ports), and `MCP_ALLOWED_HOSTS` feeds it; `GET`/`DELETE /mcp` return 405; the 401 body is JSON-RPC error `-32001`. Phase 3 test helpers that start servers via `startMcpHttpServer` must pass `allowedHosts` (for example `['127.0.0.1', 'localhost']`) and may pass `host`.
**Tests:**
- `loadEnv` rejects a missing var with a readable message.
- The auth middleware: 401 without a header, 401 with a wrong token, passes with the right one (bearer and header kinds).
- `startMcpHttpServer` + the SDK client: `listTools` returns a registered tool; `/healthz` returns 200.

**Commit(s):** `feat(shared): add logger, env loader and upstream auth middleware`, `feat(shared): add reusable stateless MCP HTTP server bootstrap`

### Task 2.3: WooCommerce client (OAuth1)
**Files:** `apps/mcp-woocommerce/src/woo/{oauth1,client,errors,period}.ts`, `test/{oauth1,client,period}.test.ts`

**Interfaces:**
```ts
export function signOAuth1(p: { method: string; url: string; consumerKey: string; consumerSecret: string; nonce?: string; timestamp?: number }): URLSearchParams; // HMAC-SHA256, query-string params
export class WooApiError extends Error { status: number; code: string }
export class WooClient { constructor(o: { baseUrl: string; consumerKey: string; consumerSecret: string; timeoutMs: number; fetchImpl?: typeof fetch });
  get<T>(path: string, query?: Record<string, string | number | undefined>): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>; put<T>(path: string, body: unknown): Promise<T>; }
export type Period = 'today' | 'yesterday' | 'last_7_days';
export function resolvePeriod(period: Period, timeZone: string, now?: Date): { after: string; before: string };
```
**Tests:**
- An OAuth1 signature with a fixed nonce/timestamp matches a known vector (computed with an independent implementation; document how).
- The client maps a WooCommerce `{code,message,data:{status}}` error to `WooApiError`.
- A timeout produces `WooApiError` code `timeout`.
- `resolvePeriod('today','Asia/Kolkata', 2026-10-18T20:00Z)` gives after `2026-10-18T18:30:00.000Z`, before `2026-10-19T18:30:00.000Z`, and the same pattern for yesterday and last_7_days.

**Commit:** `feat(woo-mcp): add OAuth1-signed WooCommerce REST client with period resolution`

### Task 2.4: Tools
**Files:** `apps/mcp-woocommerce/src/tools/{listProducts,createProduct,listOrders,getOrder,updateOrderStatus,ping,index,format}.ts`, `src/server.ts`, `src/config.ts`, `test/tools.test.ts`

**Interfaces:** `registerWooTools(server, woo: WooClient, cfg: { storeTimeZone: string }): void`. **As built:** `registerWooTools(server: SdkMcpServer, deps: ToolDeps)` with `ToolDeps = { woo: WooApi; storeTimeZone: string; now: () => Date }`, and `WooApi` is an interface (`get`, `post`, `put`) that `WooClient` implements. Each tool returns `{ content: [{type:'text', text}], structuredContent }`; on `WooApiError` it returns `{ isError: true, content: [{type:'text', text:'WooCommerce returned <status>: <message>'}] }`.
**Tests (with a fake `WooClient`):**
- Each tool's happy path.
- Zod rejects bad input (negative price, unknown status).
- `list_orders({period:'today'})` passes the after/before bounds.
- An error maps to `isError`.

**Config env:** `PORT=3001`, `WOO_BASE_URL`, `WOO_CONSUMER_KEY`, `WOO_CONSUMER_SECRET`, `MCP_AUTH_TOKEN`, `STORE_TIMEZONE`, `WOO_TIMEOUT_MS=10000`. **As built, also:** `WOO_SIGNING_BASE_URL` (required, must start with `http://`), `LOG_LEVEL`, and `MCP_ALLOWED_HOSTS` (default `localhost,127.0.0.1`, hostnames only).
**Commit(s):** one per 2–3 tools, e.g. `feat(woo-mcp): add product tools`, `feat(woo-mcp): add order tools and server entrypoint`

### Task 2.5: Container image + Helm
**As built (Phase 2):** one shared `docker/node-app.Dockerfile` (build arg `APP`), images tagged `urumi/<app>:<git short sha>` (plus `-dirty-<timestamp>`), the tag recorded in the git-ignored `deploy/.images.local.yaml`, `up.ps1` builds before deploying, Secret `mcp-woocommerce-token` (key `token`, canonical namespace `mcp`; **Phase 3 copies it into `gateway`** with the same canonical namespace) and a copy of `store-woo-api` in `mcp`. See ADR-005/007 and docs/run-guide.md section 8.

**Files (original plan):** `apps/mcp-woocommerce/Dockerfile` (multi-stage, `node:24-alpine`, `USER node`, `npm ci --workspace`), `.dockerignore` (root), `scripts/build-images.ps1` (builds all app images tagged `urumi/<app>:dev` and runs `k3d image import -c urumi`), `charts/.../templates/mcp/{mcp-woocommerce,secrets}.yaml` (Deployment, ClusterIP Service, **no Ingress**, probes on `/healthz` and `/readyz`, resources, read-only root FS + `/tmp` emptyDir)

**Verify (user):**
- `kubectl -n mcp port-forward svc/mcp-woocommerce 3001:3001`.
- Run Inspector against `http://localhost:3001/mcp` with header `Authorization: Bearer <token from Secret>`. It shows 6 tools.
- `create_product {name:"Demo Mug", regular_price:"12.50"}` → visible at `http://store.localhost/shop`.

**Commit(s):** `build: add Dockerfile and image build/import script`, `feat(helm): deploy WooCommerce MCP server as internal-only service`, `docs: document WooCommerce MCP server tools and store integration`

---

# Phase 3 — Gateway core + two upstreams (branch `phase-3-gateway`)

**Learning focus:** the gateway as MCP client and server, credential flow, failure isolation, hashing vs encryption.

### Task 3.1: Notes and Utilities MCP servers
**Files:** `apps/mcp-notes/src/{server,store,tools}.ts` + tests; `apps/mcp-utilities/src/{server,tools,calc,dates}.ts` + tests; Dockerfiles; `templates/mcp/{mcp-notes,mcp-utilities}.yaml`
**Interfaces:**
- Notes: `NotesStore { create(title, content): Note; list(): Note[]; search(q): Note[]; delete(id): boolean }`.
- Utilities: `evaluate(expr: string): number` (a recursive-descent parser over `+ - * / % ^ ( )` and decimals; throws `CalcError`; **no `eval`**), `dateRange(preset, tz, now?)`.
- Auth: notes uses `{kind:'bearer'}`; utilities uses `{kind:'header', header:'x-utilities-key'}`.

**Tests:**
- Calc precedence, parentheses, division by zero, and an injection attempt (`process.exit()`) that throws `CalcError`.
- Notes search is case-insensitive.
- `dateRange` matches `resolvePeriod` semantics.

**Commits:** `feat(notes-mcp): add bearer-protected notes MCP server`, `feat(utilities-mcp): add header-protected utilities MCP server`, `feat(helm): deploy notes and utilities MCP servers`

### Task 3.2: Gateway scaffold, config, DB schema, migrations
**Files:** `apps/gateway/{package.json,tsconfig.json,vitest.config.ts,drizzle.config.ts}`, `src/{index,app,config}.ts`, `src/db/{schema,client,migrate}.ts`, `drizzle/` (generated SQL), `test/helpers/testDb.ts` (PGlite)

**Interfaces:**
- `createApp(deps: AppDeps): express.Express`, where `AppDeps = { db: Db; config: Config; logger: Logger; upstreams: UpstreamManager; llm: LlmProvider | null; clock?: () => Date }`. Dependency injection is what makes tests easy.
- `type Db = NodePgDatabase<typeof schema> | PgliteDatabase<typeof schema>`.
- `runMigrations(db)`.

The tables are exactly as spec §6.1.

**Tests:** migrations apply on PGlite; `/healthz` 200; `/readyz` 503 when the DB ping fails.
**Commit:** `feat(gateway): scaffold Express app with config, Drizzle schema and migrations`

### Task 3.3: Security primitives
**Files:** `src/security/{crypto,passwords,ssrf}.ts`, `test/security/*.test.ts`
**Interfaces:**
```ts
export function randomToken(bytes?: number): string;                       // base64url
export function sha256Hex(input: string): string;
export function generateApiKey(): { plaintext: string; prefix: string; hash: string };  // ugw_ + base62(32B)
export function encryptSecret(plain: string, key: Buffer): Buffer;        // nonce(12)|ct|tag(16)
export function decryptSecret(blob: Buffer, key: Buffer): string;          // throws on tamper
export function hashPassword(p: string): Promise<string>; export function verifyPassword(hash: string, p: string): Promise<boolean>;
export class SsrfError extends Error { reason: string }
export function assertSafeUpstreamUrl(url: string, o: { allowedInternalHosts: string[]; lookup?: (host: string) => Promise<string[]> }): Promise<URL>;
```
**Tests:**
- An encrypt/decrypt round trip; a tampered byte throws.
- API key format regex; the hash is stable.
- SSRF rejects `http://169.254.169.254/`, `http://localhost`, `http://[::1]`, `file:///etc/passwd`, `http://10.0.0.5` (not allowlisted), and a hostname resolving to 127.0.0.1 (rebinding).
- SSRF allows `http://mcp-notes.mcp.svc.cluster.local:3002/mcp` (allowlisted) and a public IP.

**Commit:** `feat(gateway): add crypto, password hashing and SSRF guard primitives`

### Task 3.4: Upstream connection, naming and manager
**Files:** `src/upstreams/{naming,connection,manager,repository,seed}.ts`, `test/upstreams/*.test.ts`, `test/helpers/fakeUpstream.ts` (spins up real in-process MCP servers via `startMcpHttpServer`: `healthy`, `slow` (sleeps 30s), and a closed port for `dead`)
**Interfaces:**
```ts
export const SLUG_RE: RegExp; export const TOOL_SEP = '__';
export function toGatewayToolName(slug: string, tool: string): string | null;   // null if result violates ^[a-zA-Z0-9_-]{1,64}$
export function parseGatewayToolName(name: string): { slug: string; tool: string } | null;
export type UpstreamStatus = 'connected' | 'unreachable' | 'disabled' | 'unknown';
export interface UpstreamRecord { id: string; slug: string; name: string; url: string; enabled: boolean; auth: UpstreamAuth }
export interface GatewayTool { name: string; description: string; inputSchema: object; serverId: string; serverSlug: string; upstreamName: string }
export interface CallContext { userId: string; apiKeyId: string | null; source: 'mcp' | 'chat' }
export class UpstreamConnection { constructor(r: UpstreamRecord, logger: Logger);
  listTools(timeoutMs: number): Promise<UpstreamToolInfo[]>; callTool(tool: string, args: unknown, timeoutMs: number): Promise<CallToolResult>; close(): Promise<void> }
export class UpstreamManager { constructor(o: { repo: UpstreamRepository; audit: AuditWriter; logger: Logger; healthIntervalMs: number; healthTimeoutMs: number; callTimeoutMs: number; ssrf: SsrfOptions });
  start(): Promise<void>; stop(): Promise<void>; upsert(r: UpstreamRecord): Promise<void>; remove(id: string): Promise<void>; refresh(id: string): Promise<void>;
  listTools(): GatewayTool[]; getState(id: string): { status: UpstreamStatus; lastError: string | null; tools: GatewayTool[]; checkedAt: Date | null };
  callTool(gatewayName: string, args: unknown, ctx: CallContext): Promise<CallToolResult>; }
export function seedUpstreams(repo: UpstreamRepository, seeds: SeedServer[], encKey: Buffer): Promise<void>;  // insert-if-absent by slug
```
**Tests (integration with the fake upstreams):**
- Listing includes `healthy__*` but not dead tools.
- Listing returns in < 200 ms even while `slow` hangs.
- Collision: two upstreams both exposing `ping` become `a__ping` and `b__ping`.
- A call routes to the right upstream with the right auth header (the fake asserts it received the credential and *not* the client key).
- The slow call times out with `isError` containing `did not respond within`, and the audit outcome is `timeout`.
- Disabling removes the tools.
- A dead upstream is `unreachable` with a `lastError`.
- An unknown slug returns `denied`.

**Commits:** `feat(gateway): add tool naming scheme with collision-safe prefixes`, `feat(gateway): add upstream connection and health-checked manager`, `test(gateway): cover slow, dead and colliding upstreams`

### Task 3.5: Auth: users, sessions, API keys, invites, internal token
**Files:** `src/auth/{users,sessions,apiKeys,invites,internalToken,middleware,bootstrap,rateLimit}.ts`, `src/api/{auth,invites,users,keys}.routes.ts`, tests
**Interfaces:**
```ts
export type AuthUser = { id: string; email: string; name: string; role: 'admin' | 'member' };
export type BearerAuthResult = { ok: true; user: AuthUser; apiKeyId: string | null; source: 'mcp' | 'chat' } | { ok: false; reason: 'missing' | 'unknown' | 'revoked' | 'disabled' | 'expired'; userId: string | null };
export function authenticateBearer(db: Db, header: string | undefined, internalSecret: string): Promise<BearerAuthResult>;
export function mintInternalToken(userId: string, secret: string, ttlSec?: number): string;   // HS256 JWT aud=gateway-chat, exp 300s
export function requireSession(): RequestHandler; export function requireRole(role: 'admin'): RequestHandler; export function csrfGuard(publicOrigin: string): RequestHandler;
```
**Tests (supertest + PGlite):**
- Bootstrap creates the admin once.
- Login: success, wrong password, rate limit after 10 attempts.
- An invite is created, accepted once, and its reuse is rejected.
- An expired invite is rejected.
- A member creates a key (plaintext returned once; the DB stores only the hash).
- Revoke → `authenticateBearer` returns `revoked` with `userId` set.
- A member cannot list users (403).
- An admin issues a key for a member.
- A disabled user's keys are rejected.
- CSRF: a POST with a foreign `Origin` → 403.

**Commits:** `feat(gateway): add session login, bootstrap admin and rate limiting`, `feat(gateway): add invites and user management`, `feat(gateway): add hashed per-user API keys with revocation`

### Task 3.6: Servers API, audit, and the aggregated `/mcp` endpoint
**Files:** `src/api/{servers,audit}.routes.ts`, `src/audit/{writer,query}.ts`, `src/mcp/endpoint.ts`, tests
**Interfaces:**
- `AuditWriter.record(e: AuditEntry): Promise<void>`
- `createMcpEndpoint(deps): RequestHandler`. Per ADR-007 (decided in Task 2.1) this uses **`McpServer` with raw `tools/list` and `tools/call` handlers on `mcp.server.setRequestHandler`** (tools are dynamic, with raw JSON schemas; the deprecated low-level `Server` class is not used), built per request via `createMcpHandler`, in stateless mode. Its Host allow-list must include the gateway's public host. It handles `tools/list` → `manager.listTools()` and `tools/call` → `manager.callTool(...)`.
- On `/mcp`, auth failure → HTTP 401 with JSON-RPC error `-32001 Unauthorized` + audit `auth_rejected`.

**Server API rules:**
- The credential is write-only (`hasCredential` in responses).
- SSRF is checked on create and edit.
- The slug is immutable on PATCH.
- DELETE closes the connection and keeps the audit rows (`server_slug` is denormalized).

**Tests:**
- An end-to-end MCP client against `createApp` with fake upstreams lists the prefixed tools; a call is audited with the right user.
- A revoked key → 401 + an audit row attributed to the owner.
- A member cannot POST `/api/servers`.
- No API response contains the credential plaintext (a test greps every server endpoint's JSON).

**Commits:** `feat(gateway): add server registry API with encrypted credentials and SSRF checks`, `feat(gateway): add audit log writer and query API`, `feat(gateway): expose aggregated MCP endpoint with per-user auth`

### Task 3.7: Gateway + Postgres on Kubernetes
**Files:** `apps/gateway/Dockerfile`, `templates/gateway/{postgres-secret,postgres-statefulset,postgres-service,gateway-secrets,gateway-configmap,gateway-deployment,gateway-service,ingress}.yaml`
- The ConfigMap holds `SEED_SERVERS` (woo, notes, utilities with internal URLs and credential env names).
- The Ingress for `app.localhost` routes `/api` and `/mcp` to the gateway (the dashboard `/` is added in Phase 4).

**Verify (user):**
- Log in with curl to get a cookie, create an API key, and run Inspector against `http://app.localhost/mcp` with `Authorization: Bearer ugw_…`.
- About 16 prefixed tools from 3 servers appear.
- `woo__list_orders {period:"today"}` works.
- `kubectl -n mcp scale deploy mcp-utilities --replicas=0` → within 15s the `utils__*` tools are gone and the others still work. Scale it back up.
- Revoke the key → the next call returns 401.

**Commits:** `feat(helm): deploy gateway and Postgres with seeded upstream registry`, `docs: document gateway aggregation, routing, naming and failure handling`. The docs update covers `docs/system-design.md`, `docs/workflows.md`, `docs/error-handling.md`, `docs/security.md` (partial) and the diagrams.

---

# Phase 4 — Dashboard + chat agent (branch `phase-4-dashboard-chat`)

**Learning focus:** the LLM tool loop, provider abstraction, acting-as-user.

### Task 4.1: LLM provider layer (spike first, ≤ 45 min)
- **Spike:** with the user's Groq key, call `openai/gpt-oss-120b` and `llama-3.3-70b-versatile` with 16 tool definitions and the two demo questions. Pick the model with correct tool calls and lower token use, and check the account's limits page. Record the result in `docs/ai-integration.md` and ADR-011.
- **Files:** `src/chat/llm/{types,openaiCompatible,providers,registry,errors}.ts`, tests with mocked `fetch`
- **Interfaces:**
```ts
export interface ChatMessage { role: 'system' | 'user' | 'assistant' | 'tool'; content: string | null; toolCalls?: ToolCall[]; toolCallId?: string }
export interface ToolSpec { name: string; description: string; parameters: object }
export interface ToolCall { id: string; name: string; arguments: string }
export interface LlmProvider { readonly name: string; chat(r: { messages: ChatMessage[]; tools: ToolSpec[]; signal: AbortSignal }): Promise<{ message: ChatMessage; toolCalls: ToolCall[] }> }
export class LlmError extends Error { code: 'LLM_RATE_LIMITED' | 'LLM_AUTH_FAILED' | 'LLM_UNAVAILABLE' | 'LLM_BAD_RESPONSE' | 'LLM_NOT_CONFIGURED'; retryAfterSec?: number }
export function createLlmFromEnv(env: LlmEnv, fetchImpl?: typeof fetch): LlmProvider | null;   // wraps primary + optional fallback with retry
```
- **Tests:**
  - Request body shape (`tools[].type === 'function'`).
  - Parsing of `tool_calls`.
  - 429 with `retry-after: 1` → retried, then succeeds.
  - Exhausted retries → fallback is used.
  - 401 → `LLM_AUTH_FAILED` with no retry.
  - Malformed JSON → `LLM_BAD_RESPONSE`.
- **Commit:** `feat(gateway): add provider-agnostic LLM layer with retries and fallback`

### Task 4.2: Agent loop + `/api/chat`
- **Files:** `src/chat/{agent,mcpLoopback,systemPrompt}.ts`, `src/api/chat.routes.ts`, tests
- **Interfaces:**
```ts
export interface AgentToolTrace { name: string; arguments: unknown; outcome: 'success' | 'error'; durationMs: number; resultPreview: string }
export interface AgentTurnResult { reply: string; toolCalls: AgentToolTrace[]; stoppedReason: 'final' | 'max_steps' | 'timeout' }
export function runAgentTurn(o: { history: ChatMessage[]; llm: LlmProvider; mcp: McpToolClient; now: Date; storeTimeZone: string; maxSteps?: number; signal: AbortSignal }): Promise<AgentTurnResult>;
export interface McpToolClient { listTools(): Promise<ToolSpec[]>; callTool(name: string, args: unknown): Promise<{ isError: boolean; text: string }>; close(): Promise<void> }
export function connectLoopback(gatewayBaseUrl: string, internalToken: string): Promise<McpToolClient>;   // real MCP client to http://127.0.0.1:<port>/mcp
```
- **Tests:**
  - A fake LLM calls `woo__list_orders` then answers → trace recorded.
  - Max steps is enforced.
  - Tool results are truncated to 6000 chars.
  - A tool error is surfaced to the model and the trace.
  - An integration test: `/api/chat` with a fake LLM + fake upstream → the audit row has `source='chat'` and the session user.
- **Commit:** `feat(gateway): add chat agent tool loop acting as the logged-in user via MCP loopback`

### Task 4.3: Dashboard foundation + design system
- **Files:** `apps/dashboard/{package.json,vite.config.ts,tailwind config,index.html}`, `src/{main,App,router}.tsx`, `src/lib/{api,auth,queryClient}.ts`, `src/components/ui/{Button,Input,Select,Badge,Card,Table,Dialog,ConfirmDialog,Toast,EmptyState,ErrorState,Skeleton,CopyField}.tsx`, `src/components/layout/{AppShell,Sidebar,TopBar}.tsx`, `src/styles/tokens.css`
- Invoke the `frontend-design:frontend-design` skill at the start of this task for visual direction.
- **Interfaces:** `apiFetch<T>(path, init?)` throws `ApiError {code,message,status,requestId}`; `useMe()`; `<RequireRole role="admin">`.
- **Tests:** a Vitest + Testing Library smoke test for `Button` and `ConfirmDialog` (focus trap, Esc closes); `apiFetch` error mapping.
- **Commit:** `feat(dashboard): add design system, app shell and typed API client`

### Task 4.4: Pages
**Files:** `src/pages/{Login,AcceptInvite,Overview,Servers,ServerDetail,Team,Keys,Audit,Chat}.tsx`, plus feature components (`ServerFormDialog`, `KeyCreatedDialog` with Claude Code/Cursor/Inspector snippets, `ToolCallTrace`)

Every page has loading, empty and error states; member/admin gating is backed by API 403s.

**Commits:** one per page group: `feat(dashboard): add login and invite acceptance`, `feat(dashboard): add servers list, detail and admin management`, `feat(dashboard): add team management and API keys`, `feat(dashboard): add audit log with filters`, `feat(dashboard): add chat with tool-call trace`

### Task 4.5: Dashboard image + Ingress + E2E smoke
- **Files:** `apps/dashboard/{Dockerfile,nginx.conf}` (nginx-unprivileged, SPA fallback, port 8080), `templates/gateway/dashboard-*.yaml`, Ingress `/` → dashboard, `e2e/smoke.spec.ts` (Playwright; viewports 1440×900 and 390×844)
- **Verify (user):** the full user-story walkthrough in the browser at both widths. The chat as admin creates a product, then lists today's orders after a manual checkout.
- **Commits:** `feat(helm): serve dashboard through ingress alongside gateway API`, `test(dashboard): add Playwright smoke at desktop and mobile viewports`, `docs: document chat agent, AI provider setup and dashboard workflows`

---

# Phase 5 — Hardening + production values (branch `phase-5-hardening-prod`)

### Task 5.1: NetworkPolicies
- **Files:** `templates/network/{default-deny,allow-store,allow-mcp,allow-gateway,egress-mcp}.yaml` (toggle `networkPolicies.enabled`), `scripts/test-network-policies.ps1`
- **Probe matrix** (each check is `kubectl run --rm -i --restart=Never curl --image=curlimages/curl -n <ns> --labels=<...> -- curl -m 5 ...`):

  | From | To | Expected |
  |---|---|---|
  | default ns | mcp-woocommerce | timeout |
  | mcp-notes-labeled pod | wordpress | timeout |
  | gateway-labeled pod | mcp-woocommerce | 401 (reachable) |
  | mcp-woocommerce-labeled pod | wordpress | 200 |
  | default ns | postgres / mariadb | timeout |

- **Commit(s):** `feat(helm): add default-deny NetworkPolicies with explicit allow rules`, `test: add NetworkPolicy probe script`

### Task 5.2: Pod hardening review
- Audit every template for the securityContext constraints; add `automountServiceAccountToken: false` everywhere (no component uses the Kubernetes API).
- ~~Document the WordPress/MariaDB root exception.~~ Superseded in Phase 1: the store runs non-root with no exception (spec §8.5, ADR-004); this task only re-audits that.
- **Verify:** `kubectl get pods -A -o jsonpath` shows runAsNonRoot for our workloads.
- **Commit:** `feat(helm): enforce non-root, read-only filesystems and no service account tokens`

### Task 5.3: Production values + render validation
- **Files:** `deploy/values-prod.yaml` (complete), `docs/deployment.md` §"Production-like VPS (k3s)": VPS sizing, install k3s (`curl -sfL https://get.k3s.io | sh -`), DNS records, cert-manager, `kubectl create secret` for every `existingSecret`, pushing images to GHCR, `helm upgrade --install`, verification, logs, **upgrade and rollback** (`helm history`, `helm rollback urumi <rev>`), and backups (`mysqldump`/`pg_dump` Job examples).
- **Verify:** `helm lint -f deploy/values-prod.yaml`; `helm template -f deploy/values-prod.yaml` piped through a kubeconform check (`docker run ghcr.io/yannh/kubeconform`). Optionally, if RAM allows, install the prod values into a second k3d cluster with fake hostnames to prove they work.
- **Commit:** `feat(helm): complete production values and k3s VPS deployment guide`

### Task 5.4: Full definition-of-done run
- Write `docs/demo-script.md`, with every DoD bullet as a numbered step, its exact command or click, and the expected result.
- Execute it end to end: user A in the dashboard chat; user B in Claude Code (`claude mcp add --transport http urumi http://app.localhost/mcp --header "Authorization: Bearer ugw_…"`); the cross-server prompt; revoke; disable; kill a pod; audit log.
- Fix anything that fails (use the superpowers:systematic-debugging skill), with one `fix:` commit per issue.
- **Commit:** `docs: add definition-of-done demo script verified end to end`

---

# Phase 6 — Documentation + demo prep (branch `phase-6-docs-demo`)

### Task 6.1: Required technical docs (complete and accurate)
- `docs/architecture.md`, `system-design.md`, `workflows.md`, `diagrams/*.md`
  - Diagrams: architecture, MCP call sequence, chat loop, credential flow, auth/key lifecycle, upstream health state machine, NetworkPolicy map, Helm/K8s resource map, plus text explanations.
- `ai-integration.md` (how to get Groq and OpenRouter keys, quotas, switching providers, adding an adapter, errors), `error-handling.md`, `security.md`, `testing.md`, `troubleshooting.md`, `deployment.md`.
- **Commits:** one per 2–3 documents.

### Task 6.2: Assignment-specific notes
- `docs/system-design-and-tradeoffs.md` (short): architecture choices; aggregation, routing and failure handling; what changes for production (DNS, ingress, storage class, secrets).
- `docs/threat-model.md` (short): shared upstream credentials; why there's no token passthrough; malicious tool descriptions; member-vs-member; malicious or compromised upstream.
- `docs/stand-out-items.md`: security hardening with file pointers; everything else not attempted.
- **Commit:** `docs: add system design/tradeoffs note, threat model and stand-out items list`

### Task 6.3: README (all 22 CLAUDE.md sections)
- Beginner-sequential: prerequisites → `.wslconfig` → install tools → clone → `.env` → `cluster-up` → `setup-hosts` → `build-images` → `create-secrets` → `deploy` → first login → place an order → connect Claude Code/Cursor/Inspector → use the chat → tests → VPS pointer → troubleshooting → limitations.
- Screenshots go in `docs/images/`, captured with Playwright.
- **Verify:** follow the README from a fresh clone into a fresh cluster (`cluster-down`, then the README steps) with no undocumented fixes.
- **Commit:** `docs: write complete beginner-friendly README`

### Task 6.4: Interview and demo prep
- `docs/learning/02-mcp-internals.md`: the protocol flow with real JSON-RPC payloads captured from our gateway, plus how collisions, timeouts and dead upstreams are handled.
- `docs/learning/03-interview-qa.md`: the about 30 likeliest questions with answers grounded in our code (file:line pointers).
- `docs/demo-video-outline.md`: the 6 required sections, timing, and what to show on screen.
- **Commit:** `docs: add MCP internals walkthrough, interview Q&A and demo video outline`

---

## Carry-forward issues (from Phase 0 final review)

The whole-branch review of Phase 0 found issues that belong to later phases. They are recorded here so they are not lost. **Each phase plan MUST resolve the items for its phase** (tick the box and say how in the phase plan or the relevant ADR/spec section).

### Phase 1

- [x] **Generated Secrets diverge across namespaces.** *(Resolved → Task 1.1 `urumi.generatedValue` memo + canonical-namespace `lookup`, used in Tasks 1.2-1.3; Phase 2 reuses it for the `mcp` copy.)* `randAlphaNum` runs per copy and `lookup` only sees its own namespace. Resolution: generate each value once per render (memoise in a dict in `_helpers.tpl`), always `lookup` one canonical namespace (e.g. `store` for `store-woo-api`, `mcp` for upstream tokens), and document that prod `existingSecret`s must exist in both namespaces.
- [x] **`resource-policy: keep` covers PVCs but not Secrets** *(Resolved → Tasks 1.2/1.3 annotations; Task 1.5 uninstall/reinstall test; ADR-003)*, so DB logins and the encryption key break after uninstall and reinstall. Resolution: also annotate generated credential Secrets with `keep`. In ADR-003, note that PVCs from `volumeClaimTemplates` are not Helm-managed (they survive uninstall anyway), so `keep` matters only for the standalone WordPress PVC.
- [x] **Security contexts.** *(Resolved → Task 1.2 MariaDB uid 999; Task 1.3 WordPress uid 33 + sysctl + `copy-wordpress` initContainer; Task 1.4 Job uid 33 waiting for `wp-config.php`; spec §8.5 and ADR-004 updated in Task 1.5. Postgres uid 999 remains for Phase 3.)* `capabilities.drop: [ALL]` breaks the root-running WordPress (needs NET_BIND_SERVICE, SETUID, SETGID, CHOWN, possibly DAC_OVERRIDE/FOWNER; verify). Resolution: run MariaDB non-root (`runAsUser: 999`, `fsGroup: 999`) and correct ADR-004 (cite spec §8.5); give Postgres an explicit `runAsUser: 999`; run the `wordpress:cli` Job (Alpine, www-data uid 82) as uid/gid 33 on the shared PVC, and make it wait for `wp-config.php` as well as the DB. Update the Global Constraints and spec §8.5 accordingly.
- [x] **`--wait` plus post-install hooks.** *(Resolved → Task 1.4 Step 11 and Task 1.5: install, upgrade, uninstall, reinstall and fresh install were all run; the ordering "Job starts after WordPress is Ready" was observed on the fresh install (Ready 10:46:54Z, Job 10:46:55Z), the upgrade timestamps do not demonstrate it, and the reinstall was not timed; `activeDeadlineSeconds: 480` < 10m.)* Resolution: verify the Helm 4.3.1 ordering empirically (install, upgrade, uninstall, reinstall), and keep the setup Job's `activeDeadlineSeconds` below the `--timeout 10m`.
- [x] **OAuth1 signing URL.** *(Resolved → Tasks 1.4 Steps 8-12: spike passed, ADR-005 accepted, spec §5.2/§13 corrected.)* WooCommerce rebuilds the base URI from `get_home_url()` (`WP_HOME` host, scheme from the request, i.e. http in-cluster), not from the Host header. Resolution: the spike must first try signing with `http://store.localhost/wp-json/...` while sending to the in-cluster Service; then correct ADR-005 and spec §5.2/§13.
- [x] **8081 fallback has no values-interface support.** *(Resolved → Task 1.1 `global.publicPort` + `urumi.publicUrl`; the non-default-port path is rendered by the chart but has not been run end to end.)* Resolution: add `global.publicPort` (or full public URLs) so `WP_HOME`, `PUBLIC_APP_URL` and the CSRF Origin check work on non-80 ports.
- [x] **Script ergonomics.** *(Resolved → Task 1.1 Steps 10-12.)* `setup-hosts.ps1`: add `-Wait` to the elevation and re-check afterwards. `cluster-up.ps1` and `deploy.ps1`: add a prerequisite check (`Get-Command k3d, kubectl, helm`) with a friendly message, including the PATH-refresh hint.
- [x] **Root `npm` workspace scripts exit 1 ("No workspaces found") until Phase 2.** *(Resolved → Phase 1 Global Constraints: no root `npm` script was run; the OAuth tests run with `node --test "scripts/dev/*.test.mjs"`.)* Resolution: no Phase 1 verification may run `npm test` or `npm run build`.

### Phase 2

- [x] **`WooClient` needs two URLs.** *(Resolved → Task 2.3: `WooClientOptions` has `baseUrl` and `signingBaseUrl`.)* Resolution: a separate `signingBaseUrl` (public store URL) from `baseUrl` (in-cluster Service).
- [x] **`registerWooTools` depends on the concrete class.** *(Resolved → Task 2.4: `ToolDeps.woo: WooApi`; tests use fakes.)* Resolution: take a `WooApi` interface instead of `WooClient` so tests can fake it.
- [x] **MCP server `/readyz` must not depend on the setup Job's outputs** *(Resolved → Task 2.4 (`server.ts`: `readinessCheck` is a constant `true`) and Global Constraints (a truly fresh install with the MCP pod present was not re-run in Phase 2).)* (it would deadlock `--wait` on a fresh install). Resolution: readiness checks only the process and its own config.
- [x] **No lint setup** *(Resolved → Task 2.2: ESLint flat config at the root (`npm run lint`), per-workspace `tsconfig.json` and `tsconfig.build.json`.)* (CLAUDE.md §7 requires linting). Resolution: add an ESLint flat config and a `lint` script per workspace, plus a per-workspace tsconfig with `outDir`/`rootDir`.
- [x] **Mutable image tags.** *(Resolved → Task 2.6: `build-images.ps1` tags the git short SHA (`-dirty-<timestamp>` when the tree has any change, including untracked files) and writes `deploy/.images.local.yaml`; a clean tree keeps the tag and does not restart the pod (verified).)* `:dev` with `IfNotPresent` leaves stale pods. Resolution: use a per-build tag (git short SHA) or `kubectl rollout restart` in `build-images.ps1`.
- [x] **Port the OAuth1 signer from Phase 1.** *(Resolved → Task 2.3: `src/woo/oauth1.ts`, tested against the PHP-derived vector.)* Port `buildOAuth1BaseString`/`signOAuth1Url` from `scripts/dev/woo-oauth-check.mjs` into the MCP server's `signOAuth1`, and reuse the PHP-derived known-answer vector from `scripts/dev/woo-oauth-check.test.mjs`.
- [x] **Signer limits.** *(Resolved → Task 2.3: the signer throws for unsupported query keys; documented in the server README.)* Only unique scalar query keys are supported; lists are sent comma-separated (`include=1,2`).
- [x] **Signer params hygiene.** *(Resolved → Task 2.3: a `Map` is used, and caller-supplied `oauth_*` keys are rejected.)* Use a `Map` or `Object.create(null)` for params (avoids `__proto__`), and reject caller-supplied `oauth_*` keys.
- [x] **`signingBaseUrl` derivation.** *(Resolved → Task 2.6: chart helper `urumi.storeSigningBaseUrl`; `check-woo-api.ps1` derives its `--sign-base` by the same rule. The `publicPort=8081` case was rendered with `helm template` but not run end to end.)* `signingBaseUrl` = the public store URL (`urumi.publicUrl`, i.e. `WP_HOME`) with its scheme replaced by `http`; the port stays only if it is present in `WP_HOME`, i.e. only when `publicPort` is not the default for `publicScheme` (local: `http://store.localhost`; local on 8081: `http://store.localhost:8081`; production https/443: `http://store.example.com`, no `:443`). In-cluster calls are never TLS, so WooCommerce signs with `get_home_url(null, $path, 'http')` and `set_url_scheme()` only swaps the scheme.
- [x] **Signing base chart helper.** *(Resolved → Task 2.6: helper added, passed as env `WOO_SIGNING_BASE_URL`; `check-woo-api.ps1` updated.)* Add helper `urumi.storeSigningBaseUrl` = `urumi.publicUrl` for `storeHost` with `^https?://` replaced by `http://`, and pass it to the MCP server Deployment as env `WOO_SIGNING_BASE_URL`. Derive `check-woo-api.ps1`'s `--sign-base` from the same rule (or from the deployment env) so a non-default `publicPort` works.
- [x] **Timestamp window and nonces.** *(Resolved → Task 2.3: fresh nonce and timestamp per request, no retries; documented in the server README and workflow 6.)* Respect WooCommerce's ±15 min OAuth timestamp window and its per-key nonce store: always use a fresh nonce, and never retry a request with the same nonce.
- [x] **`store-woo-api` copy in `mcp`.** *(Resolved → Task 2.6: `urumi.storeWooApiData` renders both copies; the two rendered Secrets were compared and are identical.)* Render the `store-woo-api` copy in the `mcp` namespace with `urumi.generatedValue` using canonical namespace `store`, so both copies match (the `store` copy exists since Phase 1).
- [x] **Confirm Service-DNS access and POST/PUT signing.** *(Resolved → Task 2.6: verified with `check-mcp-woocommerce.ps1 -Write` (create_product POST, update_order_status PUT); recorded in ADR-005.)* ADR-005's spike used `kubectl port-forward` and only GET; verify `http://wordpress.store.svc.cluster.local` access and signed writes.
- [x] **Image helper.** *(Resolved → Task 2.6: `urumi.image`, `global.imageRegistry`, `global.imageTag`; `deploy/values-prod.yaml` has `CHANGE-ME` placeholders.)* Add `urumi.image` plus `global.imageRegistry`/`global.imageTag` (Task 2.5).
- [x] **The `mcp` copy of `store-woo-api`.** *(Resolved → Task 2.6: rendered only when `secrets.existing.storeWooApi` is empty, annotated `keep`, built through the one shared helper.)* Render it only when `secrets.existing.storeWooApi` is empty, annotate it `keep`, and build both copies through ONE shared helper/definition so both call `urumi.generatedValue` with an identical length and prefix (otherwise the first call in a render wins).
- [x] **WooCommerce key owner.** *(Resolved → Task 2.5: `urumi-mcp` shop manager, plus an ownership marker `urumi_managed_key_owner` after review (the Job refuses to promote an unmarked user); recorded in ADR-005, the run guide and troubleshooting. The Phase 6 threat-model item below is still open.)* Create a dedicated `urumi-mcp` user with the `shop_manager` role and make it the key owner instead of the WordPress administrator. This limits the blast radius of a leaked key to products and orders. Record it in ADR-005 and in the Phase 6 threat model.
- [x] **Atomic API-key upsert.** *(Resolved → Task 2.5: update in place, else insert; `key_id` stayed 4 across redeploys. The duplicate-row cleanup path was not exercised.)* Use UPDATE-then-INSERT (keep key_id/nonces) instead of delete-then-insert.
- [x] **`urumi.podLabels` helper.** *(Resolved → Task 2.5: helper added and used by the mariadb, wordpress, store-setup and mcp pod templates.)* Selector labels + component + part-of, without `helm.sh/chart`, used for pod templates, so chart version bumps stop restarting MariaDB/WordPress. Migrate the existing pod templates in the same change.
- [x] **`_helpers.tpl` comment.** *(Resolved → Task 2.5.)* Never `toYaml .Values`, because `__generated` holds generated secrets during render.
- [x] **Deploy ordering note.** *(Resolved → Task 2.6: `up.ps1` runs `build-images.ps1` before `deploy.ps1`; `deploy.ps1` warns when the tag file is missing; documented in the run guide and deployment guide.)* `deploy.ps1 --wait` gates the post-install hook on ALL release workloads being Ready, so `build-images.ps1`/image import must run before `deploy.ps1`, or the store setup is delayed until timeout.
- [x] **Pretty permalinks.** *(Resolved → Task 2.7: apps/mcp-woocommerce/README.md "OAuth 1.0a notes".)* The signer assumes pretty permalinks (the setup Job enforces them). Note this in the MCP server docs.
- [x] **Check script port-forward fragility.** *(Resolved → Task 2.6: `scripts/check-mcp-woocommerce.ps1` is the end-to-end check (waits for the port, always stops its port-forward); `check-woo-api.ps1` itself still uses a port-forward.)* Supersede `check-woo-api.ps1`'s port-forward with an in-cluster check.

### Phase 3

- [ ] **`type Db = NodePg… | Pglite…` will not type-check** (union of generic/overloaded methods). Resolution: use Drizzle's `PgDatabase<PgQueryResultHKT, typeof schema>`; `runMigrations` dispatches to the driver-specific migrator. Align spec §11 ("Postgres test container") with PGlite.
- [ ] **`GATEWAY_ENCRYPTION_KEY` must be 32 random bytes in base64.** Resolution: Sprig `randBytes 32` (not `randAlphaNum`), and validate the decoded length at startup.
- [ ] **`audit_logs.server_id` FK** needs `ON DELETE SET NULL`.
- [ ] **Internal chat token handling.** Resolution: verify with `algorithms: ['HS256']`, and make `/mcp` re-check `users.disabled_at` for internal tokens (deny). Update ADR-010.
- [ ] **ADR-009 crypto details.** Resolution: 96-bit random nonce per encryption; use AAD = server row id.
- [ ] **`BearerAuthResult` failure variant** should carry `apiKeyId` for the audit row.
- [ ] **`AppDeps.llm` references `LlmProvider` before Phase 4.** Resolution: define the interface in Phase 3, or type it `unknown | null` and narrow later.
- [ ] **Missing LLM keys must not crash the pod.** Resolution: the gateway Deployment's `llm-api-keys` `secretKeyRef` is `optional: true` (missing gives `LLM_NOT_CONFIGURED`, not CreateContainerConfigError). Add a task creating `scripts/create-secrets.ps1`, decide a single owner for `gateway-bootstrap` (Helm), and map the LLM_* non-secrets (LLM_PROVIDER, LLM_MODEL, LLM_FALLBACK_PROVIDER) and BOOTSTRAP_ADMIN_* to Helm values (see the header of `.env.example`).
- [ ] **HTTP edge cases.** Resolution: `GET /mcp` returns 405 JSON (not Express HTML 404); if the SDK's DNS-rebinding protection is on, `allowedHosts` includes the loopback; redact `/api/invites/:token` paths in logs (ADR-013 leakage vectors).
- [ ] **Verify text and counts.** Disabled/dead upstream tools disappear within about 20 s (15 s interval + 5 s timeout), not "within 15 s" (fix the plan's verify text). The tool count is 15 (6 + 5 + 4), not 16.

### Phase 4

- [ ] **`LlmProvider` result keeps `usage?`** (spec §6.10). `AgentToolTrace.arguments` vs spec `args`: pick one and align the spec. A `ToolCall.arguments` JSON parse failure is returned to the model as a tool error.
- [ ] **LLM retry-after sleeps must stop at the 60 s turn deadline.**
- [ ] **nginx SPA fallback must return 404 for `/.well-known/*`** (MCP clients probe OAuth metadata after a 401).
- [ ] **`Referrer-Policy: no-referrer`** on the invite page.
- [ ] **Dashboard tsconfig** overrides `moduleResolution: Bundler` and adds the DOM lib.

### Phase 5

- [ ] **NetworkPolicy probe matrix** asserts "no HTTP response" (refused or timeout), not strictly "timeout". DNS egress allows UDP and TCP 53 to `k8s-app=kube-dns` in `kube-system` (labels verified on the cluster: Traefik `app.kubernetes.io/name=traefik`, CoreDNS `k8s-app=kube-dns`, namespaces `kubernetes.io/metadata.name`).
- [ ] **Missing verification tooling.** Resolution: add `scripts/smoke-test.ps1` (spec §11) and an `npm audit` security check.
- [ ] **Production TLS header handling.** Verify whether the official image's `wp-config.php` already sets HTTPS from `X-Forwarded-Proto` (grep the pod's `wp-config.php`); add handling to `WORDPRESS_CONFIG_EXTRA` only if missing.
- [ ] **HTTP to HTTPS redirect.** Traefik `web` entrypoint redirect or a Middleware.
- [ ] **cert-manager HTTP-01 solver** uses `ingressClassName: traefik`.
- [ ] **`MARIADB_ROOT_HOST=localhost`.** Applies only on first initialization of an empty data directory; document that.
- [ ] **`DISALLOW_FILE_MODS`.** Add `define('DISALLOW_FILE_MODS', true)` in `WORDPRESS_CONFIG_EXTRA` (the Job doesn't get it, so WP-CLI is unaffected). In `setup.sh`, only upgrade WooCommerce (never downgrade), then run `wp wc update`. Document that the WordPress image tag pins only the first core copy.
- [ ] **`setup.sh` hardening.** Fail on an empty `ADMIN_PASSWORD`; avoid putting the password in argv (stdin/`--prompt`); show the last DB error when the wait loop fails; reconcile `home`/`siteurl` with `$WP_URL`.
- [ ] **Bash NOTES.txt password command** for the VPS.
- [ ] **Schema.** `tls.enabled` implies `publicScheme: https`; add a hostname pattern for `storeHost`/`appHost` (they are inserted into PHP `eval`'d by `WORDPRESS_CONFIG_EXTRA`).
- [ ] **`deploy.ps1` reverse context guard.** Refuse prod values on `k3d-urumi`.
- [ ] **Pod Security Admission.** Add `pod-security.kubernetes.io/enforce: restricted` labels on the store namespace (verify the pods comply; the sysctl is on the PSS safe list).
- [ ] **Pre-created Secret docs.** The "wrong keys" troubleshooting entry and the values-prod comments should mention the namespace ownership-metadata step. Quote placeholder passwords, or use `--from-file`/`Read-Host -AsSecureString` instead of `--from-literal`.
- [ ] **Customer registration toggle (from the Phase 1b review).** Add a `storeSetup.customerRegistration` values toggle: off, or on with anti-spam (CAPTCHA, email verification), in `values-prod.yaml`. Open registration plus COD guest checkout lets bots create fake accounts and orders.
- [ ] **Bind k3d ports to loopback.** Consider `127.0.0.1` for ports 80/443 in `deploy/k3d-config.yaml` so the local store is not reachable from the LAN. This requires recreating the cluster, which deletes data.
- [ ] **Password helpers for production.** `scripts/get-admin-password.ps1` and `get-db-password.ps1` hard-code namespace `store` and the Secret names; make them honor `namespaces.store` and `secrets.existing.*`.
- [ ] **Optional `tcpSocket` liveness probe for WordPress** (it doesn't depend on the DB).
- [ ] **Document** Docker Hub anonymous pull limits and the dependency on downloads.wordpress.org on fresh installs.

### Phase 6

- [ ] **`security.md`: Helm release Secret exposure.** The Helm release Secret `sh.helm.release.v1.urumi.vN` in `urumi-system` contains the rendered Secret manifests (all generated passwords), so read access to Secrets in `urumi-system` equals read access to all credentials.
- [ ] **Threat model: WooCommerce key owner.** Cover the `urumi-mcp` `shop_manager` key owner (see the Phase 2 item).

### Accepted as-is (no change)

- `cluster-down.ps1` errors if the cluster is absent (failing loudly is fine).
- Several primer concepts list 2-3 commands.
- `hello.yaml` has no securityContext (it is a teaching example).
- The built versions of the Task 0.2/0.3 files differ from the plan's code (`.superpowers/` in `.gitignore`, the hardened `cluster-up.ps1`); the built versions are better.
- Relative `-ValuesFile` is resolved against the repo root (intended).
- `helm status` exit code is unchecked (informational).
- Passwords are passed via env, not `_FILE` (optional hardening).
- The initContainer checks only `index.php`.
- Seeding is all-or-nothing; `task_list_hidden_lists` is overwritten.
- `check-woo-api.ps1` port-forward fragility (dev tool; superseded by an in-cluster check in Phase 2).

---

## Self-review (done when writing this plan)

- **Spec coverage:**
  - §5.1 → 1.2–1.5
  - §5.2 → 2.3–2.5
  - §5.3 → 3.1
  - §6.1 → 3.2
  - §6.2 → 3.5, 3.6
  - §6.3–6.5 → 3.4, 3.6
  - §6.6 → 3.3, 3.6
  - §6.7 → 3.5
  - §6.8 → 3.6
  - §6.9 → 4.2
  - §6.10 → 4.1
  - §7 → 4.3–4.5
  - §8 → 1.1–1.4, 2.5, 3.7, 4.5, 5.3
  - §8.6 → 5.1
  - §9 → 3.3, 5.1, 5.2, 6.2
  - §10 → 6.1
  - §11 → tests in every task + 4.5, 5.1, 5.4
  - §12 → 6.1–6.4
  - §4 → 2.1
- **Type consistency:** `UpstreamAuth` (2.2) is reused by 3.1, 3.4 and 3.6; `CallContext.source` matches the audit `source` column; `BearerAuthResult.source` matches the `CallContext` source; `ToolSpec` (4.1) is used by `McpToolClient` (4.2).
- **Deliberately deferred to phase plans:** exact implementation code for Phases 1–6. Each phase plan must be written before that phase starts, with failing-test-first steps.
