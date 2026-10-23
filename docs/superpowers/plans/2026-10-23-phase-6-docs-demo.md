# Phase 6 — Documentation and Demo Preparation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** make the repository ready to submit:
- every deliverable the assignment lists is present, accurate and easy to find;
- the definition-of-done demo script matches the assignment **exactly** and has been run;
- the README takes a beginner from a fresh clone to a working system;
- the demo video and the interview are prepared.

No product behaviour changes.

**Architecture:** documentation and demo tooling only.
- **New docs:** the assignment notes (system design and trade-offs, threat model, stand-out items, assignment checklist), a Helm/Kubernetes resource-map diagram, a demo-video outline and an interview Q&A.
- **Corrected docs:** the existing docs are swept for stale "planned / Phase N" wording and counts.
- **Demo script:** rewritten against the assignment's definition of done and run live.
- **README:** rewritten section by section, then followed from a fresh clone.
- **Screenshots:** refreshed with a dedicated Playwright capture script that never shows a secret.

**Tech Stack:** as Phase 5b. The only new code is a Playwright screenshot spec and a dev script; no app code changes.

**Spec and sources:**
- [`docs/superpowers/specs/2026-10-18-mcp-gateway-design.md`](../specs/2026-10-18-mcp-gateway-design.md): §10 docs, §11 verification.
- The master plan [`2026-10-18-mcp-gateway-implementation-plan.md`](2026-10-18-mcp-gateway-implementation-plan.md): Phase 6 tasks and the "Carry-forward → Phase 6" boxes.
- **The assignment PDF**, `../Urumi AI FDE Internship - Round 1_ MCP Gateway on Kubernetes.pdf` (parent folder, not in the repo). It is binding for:
  - the **definition of done**;
  - the **mandatory requirements**;
  - the **6 demo-video sections**;
  - the **deliverables**: a README with local setup, VPS setup, placing an order, connecting an external MCP client and using the chat; a short "System design and tradeoffs" note; a short threat model note with its 4 required points; and the stand-out and bonus list.

**Owner decisions (2026-10-23):**
1. **Docs and demo only.** The deferred UI and code polish items (a11y headings and focus, the rate-limit countdown text, audit date validation, bundle splitting, a total deadline for the startup DB wait) are **not** done. They are listed under Known limitations.
2. **The README is verified from a fresh clone against the existing cluster.** No cluster deletion. The first-install path is not re-proven; it was last proven on 2026-10-23 in Phase 5 Task 5.8.

## Global Constraints

- **Git:**
  - Branch `phase-6-docs-demo`, created from `main` at `8b655b1`.
  - Several commits per task, with conventional prefixes (`docs:`, `test:`, `chore:`).
  - **Never push. No `Co-Authored-By` or any Claude/AI attribution.**
- **Root path:** `C:\Users\Lenovo\Desktop\MCP Gateway on Kubernetes\MCP-Gateway-on-Kubernetes` (quote it). **Line endings:** LF, except CRLF for `*.ps1`.
- **No product behaviour changes:**
  - No edits under `apps/*/src`, `charts/` or the existing `scripts/*.ps1`, except a typo or a doc comment.
  - Allowed new code: a Playwright spec plus a capture script for screenshots, and dev scripts for the demo.
  - `npm test` counts must stay **671**, plus any tests of new dev tooling.
- **Accuracy (CLAUDE.md §1):** every statement is either verified (with the date) or labelled "expected" or "not tested". Nothing claims a real VPS deployment, a real Let's Encrypt certificate, real client IPs, arm64 images, the external-store chart mode installed, or a Claude Code or Cursor run that did not happen.
- **No secrets anywhere visible:**
  - Never print, log, commit or screenshot passwords, API keys, LLM keys, tokens, invite links or Secret values. Never read `.env`.
  - Screenshots must not show a key dialog, an invite link, a password field with content, or the browser address bar holding a token.
  - The owner's LAN IP never appears.
- **Short notes are short:** `system-design-and-tradeoffs.md` and `threat-model.md` are at most about 2 pages each (≈1,200 words). They link to the long docs for detail.
- **Live chat budget:** each chat turn costs about 3K of the owner's free Groq quota. Phase 6 uses at most **8 live chat turns** in total, all in Task 6.1 and the final smoke test.
- **Verification commands:**
  - `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`;
  - `scripts\validate-chart.ps1` and `helm lint` (both values files);
  - `scripts\smoke-test.ps1`;
  - a link check over `docs/` and `README.md` (relative links and anchors resolve);
  - a secret scan of `git diff 8b655b1..HEAD` (print `file:line` only).
  - Scripts are run as `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\<x>.ps1`.

## Review Focus

1. **A definition-of-done step that the demo cannot actually show.** Examples: a product created as a draft that does not appear on the storefront, a "prompt" step run with a tool that cannot prompt (MCP Inspector), or a disable step that disables a user instead of a server. Expected: every DoD bullet maps to a demo step that was run (or is explicitly the owner's live step), with its evidence. Check: Task 6.1's traceability table.
2. **A README step that fails for a newcomer**: a missing prerequisite, a wrong path, a command that needs a value nobody told them how to get, or an order of steps that does not work. Expected: the fresh-clone walk-through hits no undocumented fix. Check: Task 6.4 Step 3.
3. **A doc that contradicts the code or another doc**: counts, defaults, ports, names, or "planned" wording for built things. Expected: one truth everywhere. Check: Task 6.3's sweep and Task 6.6's grep checks.
4. **A screenshot or capture that leaks a secret** (a key dialog, an invite link, a token in the URL). Expected: none. Check: Task 6.4's capture spec never opens those dialogs, plus a manual look at every image.
5. **A threat-model or stand-out claim stronger than what is built.** Examples: "rate limits per key" when only per-user and per-IP exist; "VPS deployment" when it was only rehearsed on k3d. Expected: each item says done, partial (with exactly what) or not attempted, with file pointers. Check: Task 6.2 review.

---

### Task 6.1: The definition-of-done demo, aligned to the assignment and run live

**Files:**
- Modify: `docs/demo-script.md`, rewritten so its sections follow the assignment's definition of done **in order**: Store → Chat agent as user A → External MCP client as user B → Team and control → Audit.
- Create (if needed): `scripts/dev/place-order.ps1` (CRLF). It places one Cash-on-delivery order for a **given product id** through the storefront, the way `scripts/dev/customer-order-smoke.ps1` does. Reuse its approach: read that script first, and prefer adding a `-ProductId` parameter to it if that is simpler and keeps its default behaviour.
- Modify: `docs/run-guide.md` (link to the demo), `docs/README.md`

**What the demo must contain**, each step with its exact command or click, the expected result and what was observed on the live run:

1. **Store:**
   - storefront → add to cart → checkout with Cash on delivery;
   - the order is visible in WooCommerce admin (**WooCommerce → Orders**).
2. **Chat agent, as user A (admin):**
   - "Create a product called Demo Lamp priced 25". This must be **published**: do not ask for a draft (`create_product` defaults to `publish`). The product page opens on the storefront (`http://store.localhost/product/demo-lamp/` returns 200 and shows the name).
   - Then place an order for that product by hand on the storefront.
   - Then ask the chat "What orders came in today?". The reply lists that order.
3. **External MCP client, as user B (an invited member):**
   - **Connect:** with only the gateway URL and B's key.
     - **Primary (run in this task):** MCP Inspector CLI, `tools/list`, which shows all 15 tools of all 3 servers.
     - Then `tools/call woo__list_orders` with `period=today`, which returns the same order.
   - **Two-server prompt:** this needs an LLM client.
     - **Run here:** the same two-server task through the chat as user B (one turn), for example "Show today's orders and save a note listing their numbers". Expected tools: `woo__list_orders` and `notes__create_note`, both attributed to B in the audit log.
     - **Owner's live step (documented, not run):** the same prompt in **Claude Code**, using the `.mcp.json` + `URUMI_GATEWAY_KEY` route from the run guide, because the owner has no `claude` CLI. Cursor is an alternative.
4. **Team and control:**
   - **Revoke B's key:** the next Inspector call is **401**.
   - **Disable one upstream server** (`notes`, from Servers → `notes` → Disable):
     - its tools **disappear** from `tools/list` for the external client (the count goes from 15 to 10);
     - **and** from the chat: one chat turn "save a note: test" → no `notes__*` tool call, and the reply says it cannot.
     - Then **Enable** it again.
   - **Kill the pod of one upstream server** (`kubectl -n mcp delete pod -l app.kubernetes.io/name=mcp-utilities`):
     - other servers keep working (one `woo__list_products` call succeeds meanwhile);
     - the dashboard shows `utils` as **Unreachable**, then **Connected** again.
5. **Audit:** every call above appears in the audit log with the right user (A or B), source (`chat` or `mcp`), server, tool and outcome. Show the exact filter and the rows observed.
6. **A traceability table:** each assignment DoD bullet → demo step → evidence (observed value or "owner's live step").

**Steps:**
- [ ] **Step 1:** Read the assignment's definition of done (above), the current `docs/demo-script.md`, `scripts/dev/customer-order-smoke.ps1` and `scripts/check-gateway.ps1` (for the API login pattern).
- [ ] **Step 2:** Write or adjust `place-order.ps1` (or add `-ProductId` to the smoke script). Test it once against the store: it places a COD order and prints only the order id and status. It must never print the customer password it generates.
- [ ] **Step 3: Run the whole demo live at API level** with a scratch script in the session scratch directory (not committed).
  - **Users:** user B is a fresh invited member, `demo-b-<timestamp>@example.com`.
  - **Chat turns:** at most **5** (create product, today's orders, the two-server task as B, the disabled-server check, plus one spare).
  - **Record:** every observed value (ids, counts, HTTP codes, audit rows) in the task report.
  - **Restore afterwards:**
    - `notes` re-enabled;
    - `utils` connected;
    - B's key revoked;
    - **user B left enabled**, so the owner can reuse them in the video, and say so;
    - the test product and orders kept. Note them in the report so the owner can delete them in wp-admin.
- [ ] **Step 4: Rewrite `docs/demo-script.md`** with the observed values. Steps verified only through the API are labelled "(verified via API; click-through not run)". The Claude Code step is labelled "owner's live step".
- [ ] **Step 5: Commit.**
  - `test: place a storefront order for a chosen product`
  - `docs: definition-of-done demo aligned to the assignment and run end to end`

### Task 6.2: The assignment notes — system design and trade-offs, threat model, stand-out items, assignment checklist

**Files:**
- Create `docs/system-design-and-tradeoffs.md` (short). It covers:
  - the architecture choices: one chart, three namespaces, own MCP servers, the gateway as both client and server, a cached catalog, stateless Streamable HTTP, Postgres for gateway state, nginx for the dashboard, Groq through one adapter;
  - **how tool aggregation, routing and failure handling work**: the `slug__tool` naming and collision scheme, the cached catalog refreshed by health checks, per-call timeouts, a dead upstream removed from the list and answered with a clear `isError`, health states;
  - **what changes for production**: DNS, Ingress and TLS, storage class, secrets (pre-created Secrets with `create-prod-secrets.sh`), images (GHCR, multi-arch), and the values-file diff;
  - the main trade-offs, one line each, linking to the ADRs.
- Create `docs/threat-model.md` (short). It must cover the assignment's 4 points explicitly, each as its own heading:
  1. **Shared upstream credentials:** what a member can do with a credential they never see. They can call every tool of every enabled server as that shared identity: create products, change order statuses. Limits: the audit log, roles, and no per-tool permissions (a stand-out item not attempted).
  2. **Why client tokens are not passed through to upstreams:** the confused deputy problem, audience mismatch, revocation, and the MCP spec's guidance.
  3. **Untrusted upstreams:** tool descriptions written to manipulate the model. Cover the description cap, the `<tool_result>` wrapping and neutralisation, the scope rule and topic check, what a malicious or compromised upstream can still do (lie in results, exfiltrate the arguments it receives), and SSRF plus NetworkPolicies limiting what an upstream URL can reach.
  4. **What one team member can do to another:** members can't see others' keys or audit rows; admins can; the notes server is shared by everyone (no per-user isolation — say so plainly); chat history stays client-side; the daily budget is per user.

  Also cover:
  - the `urumi-mcp` shop_manager key owner (master-plan carry-forward);
  - the Helm release Secret exposure (master-plan carry-forward; also add it to `security.md`);
  - the topic-check residual bypass;
  - the k3d API port.
- Create `docs/stand-out-items.md`. Bonus multi-store: **not attempted**. Then each of the 9 "other ways to stand out":
  - **done, partial or not attempted**;
  - exactly what exists;
  - file pointers;
  - honest limits.

  Expected outcome:

  | Item | Status | Notes |
  |---|---|---|
  | #6 security hardening | done | SSRF guard, default-deny NetworkPolicies, non-root and restricted PSA, credentials encrypted at rest; RBAC: no component talks to the Kubernetes API, so no ServiceAccount tokens are mounted — say so |
  | #1 VPS | partial | production values and a guide, rehearsed on a second k3d cluster, **not deployed on a real VPS** |
  | #7 scaling | partial | per-user chat rate limit and daily budget, login limiter, per-IP `/mcp` failure limiter; **not** multi-replica, **not** per-key |
  | #8 observability | partial | `lastError` reasons, the audit log and log lines; **no** metrics |
  | #9 upgrades and rollback | documented | plus what was run |
  | #2, #3, #4, #5 | not attempted | |

  Also mention extras beyond the list, labelled as such: the chat guardrails, the external store, in-cluster servers.
- Create `docs/assignment-checklist.md`. Every **mandatory requirement** and every **definition-of-done bullet** from the assignment, each with **where it is in the repo** (file pointers) and **how it was verified** (script, test or demo step, with date).
- Modify:
  - `docs/security.md`: add the Helm release Secret note;
  - the master plan: tick the two "Carry-forward → Phase 6" boxes with pointers;
  - `docs/README.md`: index rows → Available.

**Steps:**
- [ ] **Step 1:** Gather facts from the code and the existing docs. Every claim gets a file pointer. Note the facts that need checking: the description cap (300 characters), the result cap (6000), the timeouts, and the limiter numbers. Read them from the code, don't guess.
- [ ] **Step 2:** Write the four files. Keep the two notes short.
- [ ] **Step 3:** Run the link check over the new files.
- [ ] **Step 4: Commit.**
  - `docs: system design and tradeoffs note and threat model`
  - `docs: stand-out items and assignment checklist`

### Task 6.3: Complete the technical docs and the diagram set

**Files:**
- Create `docs/diagrams/helm-resource-map.md`: a Mermaid diagram of what the chart renders per namespace (`store`, `mcp`, `gateway`, `urumi-system`, plus the hook Job and the CronJob), with explanatory text.
  - **Generate the facts** from `helm template charts/urumi-platform -f deploy/values-local.yaml` (kind, namespace and name), and include a table of every object with its kind, namespace and purpose.
  - Note which objects depend on values: TLS middlewares, `acme-solver`, `internalUpstreams`, `store.enabled`, the external store.
- Modify `docs/diagrams/README.md`: the resource-map row → Available, and every status line made current. No "(target architecture; … except NetworkPolicies, Phase 5)" leftovers.
- **Sweep and complete**:
  - `docs/system-design.md`, `docs/error-handling.md`, `docs/testing.md`, `docs/workflows.md` and `docs/troubleshooting.md`: replace every "Partial … completed in Phase 6" status with the final status. Add whatever the sweep shows is missing; known gaps:
    - testing.md: the current counts (671: shared 55, dashboard 133, gateway 367, notes 12, utilities 27, woo 77) and every check script with what it covers;
    - error-handling.md: a single table of every API error code and its HTTP status, as the code has them (`apps/gateway/src/api/*.ts`, `chat.routes.ts`).
  - `docs/architecture.md` and `docs/README.md`: final statuses.
  - `docs/learning/01-kubernetes-primer.md` and any other doc: remove "planned" wording for built things.
- **ai-integration.md:** check it covers how to get Groq and OpenRouter keys, quotas, switching providers, adding an adapter, the guardrails and the errors (master-plan Task 6.1 list). Add only what is missing.

**Steps:**
- [ ] **Step 1:** List the stale wording, recording the counts before and after.
  ```
  grep -rn -i -E "\(planned\)|planned —|completed in Phase 6|complete in Phase 6|Phase 6\)|not built yet|target architecture" docs README.md apps/*/README.md
  ```
  Exclude `docs/superpowers/` (history) and dated history sentences.
- [ ] **Step 2:** Write the resource map and fix every hit. For each document, check facts against the code with a pointer.
- [ ] **Step 3:** Run the link check over `docs/`.
- [ ] **Step 4:** Commit one commit per 2–3 documents:
  - `docs: Helm resource map and final diagram index`
  - `docs: final system design, error handling and testing`
  - `docs: final workflows, troubleshooting and architecture statuses`

### Task 6.4: A beginner-sequential README, refreshed screenshots, and a fresh-clone walk-through

**Files:**
- Rewrite `README.md`, keeping the 22 numbered CLAUDE.md sections in order and covering the assignment's README deliverables explicitly:
  - **local setup:** a beginner sequence of prerequisites → `.wslconfig` → tools → clone → `npm ci` → hosts (optional) → `up.ps1` → passwords (commands only) → AI key (`.env` + `create-secrets.ps1`) → first login;
  - **the local domain approach:** `*.localhost` resolves to 127.0.0.1, the loopback-only ports, and `setup-hosts.ps1` for Node tools;
  - **VPS or production setup:** a summary plus the `deployment.md` link, honest that it is rehearsed on k3d and not run on a real VPS;
  - **how to place an order;**
  - **how to connect an external MCP client:** Inspector, Claude Code (CLI or `.mcp.json`), Cursor;
  - **how to use the chat agent**, with the guardrails;
  - **how the WooCommerce MCP server talks to the store and why:** REST with OAuth1 in-cluster, and HTTPS Basic for an external store; ADR-005 and ADR-019;
  - architecture and workflow diagrams embedded as Mermaid, with links;
  - the tech stack with reasons;
  - the repository structure;
  - environment variables (a link to the tables);
  - testing and verification commands;
  - security;
  - troubleshooting;
  - the docs map;
  - known limitations, including the owner's deferred items: a11y headings and focus, the rate-limit countdown text, audit date validation, bundle splitting, the DB wait total deadline, the notes server shared by all users, and the topic-check residual bypass.

  The README must stay readable: the detail lives in the docs it links.
- Create `apps/dashboard/e2e/screenshots.spec.ts` (Playwright; a separate project or a `--grep` so it never runs in `check-dashboard.ps1`) and `scripts/dev/capture-screenshots.ps1` (CRLF).
  - **Captures**, at 1440 × 900 and at 390 px for one mobile shot: Overview, Servers, Server detail (`woo`), Audit log, Team (users list only, **no invite dialog, no invite links**), and Chat after **one** on-topic question (the calculator, 1 chat turn) showing the tool trace and the budget line.
  - **Saved as PNG** into `docs/screenshots/`, overwriting the existing names and adding `team.png`.
  - **Must never open:** the key-creation dialog, the invite dialog, a password field with content, or any URL with a token.
- Modify: `docs/README.md` and `docs/run-guide.md`, linking only where the README now points.

**Steps:**
- [ ] **Step 1: Write the README.** Every command must be one that exists in `scripts/`, and every path must exist.
- [ ] **Step 2: Capture the screenshots** (1 chat turn).
  - Look at every image yourself: no secrets, no LAN IP, no personal email other than the `example.com` demo users.
  - Commit the PNGs. Keep each under about 400 KB; use PNG compression if needed.
- [ ] **Step 3: Fresh-clone walk-through (owner decision: keep the cluster).**
  1. `git clone` the repo (the local path, branch `phase-6-docs-demo`) into the session scratch directory.
  2. **In the clone**, follow the README **literally**: `npm ci`, `npm test` (counts), `npm run typecheck`, `npm run build`, `scripts\validate-chart.ps1`, then `scripts\up.ps1 -Redeploy` (this redeploys the same cluster from the clone; the image tag is the clone's commit), then `scripts\smoke-test.ps1 -Quick`.
  3. Every place where the README was insufficient (a missing step, a wrong order, a wrong path or an unclear value) is fixed in the README and recorded in the report as found and fixed.
  4. Delete the clone afterwards. Then run `up.ps1 -Redeploy` once more from the real repo, so the cluster runs the real working tree's tag.
- [ ] **Step 4: Commit.**
  - `docs: beginner-friendly README covering every assignment deliverable`
  - `test: screenshot capture for the docs`
  - `docs: refreshed dashboard screenshots`

### Task 6.5: Demo-video outline and interview preparation

**Files:**
- Create `docs/demo-video-outline.md`. It has the assignment's **6 required sections**, in order, each with:
  - a target time (total about 20–25 min, the owner may trim);
  - what to show on screen (the exact page, command or file);
  - the talking points, with the doc pointer to read from;
  - the live DoD steps from `demo-script.md` placed inside section 1.

  The 6 sections:
  1. System design and implementation (plus the DoD live with two users).
  2. Kubernetes: what runs where (namespaces, Secrets, volumes, Ingress), requests and limits, probes, what is public and what is internal and how that is enforced. Commands: `kubectl get ns,pods,svc,ingress,pvc,secrets -A`, `kubectl describe`, `kubectl get networkpolicy -A`, the probe script.
  3. MCP internals: the upstream connection, a tool call from client to store and back, collisions, timeouts, a dead upstream.
  4. Security posture: keys and credentials, member versus admin, a malicious upstream.
  5. Chat agent: the tool loop and acting as the user.
  6. Local to VPS: the values diff, Ingress, domains, storage, secrets, and upgrade and rollback with `helm history` and `helm rollback`.

  Also include a pre-recording checklist (a reset state, the users to have ready, the windows to open, the tokens left in the budget) and the do-not-show list (passwords, keys, invite links, the `.env` file).
- Create `docs/learning/05-interview-qa.md`: about 30 likely questions in the order of the 6 video sections plus "why" questions, each with a short answer **grounded in the code** (file:line pointers checked against the current code) and a link to the long doc. Include at least:
  - why our own MCP servers, why Streamable HTTP stateless, and why a cached catalog;
  - how collisions are named, and what happens on a timeout or a dead upstream;
  - why API keys are hashed (SHA-256) and upstream credentials encrypted (AES-GCM), and where the key lives;
  - why no token passthrough;
  - how the chat acts as the user (the loopback plus the internal token);
  - what NetworkPolicies, PSA and SSRF each stop;
  - why k3d and k3s, and why Helm values per environment;
  - what happens if Postgres or the LLM is down;
  - how to upgrade and roll back;
  - what the weakest parts are and what you would do next.
- Modify `docs/learning/03-gateway.md`: add "A dead upstream, captured live", the actual `tools/call` request and response while a server is unreachable, captured in Task 6.1. Mark it not captured if it wasn't. Also add the collision scheme with a worked example (two servers, both with `ping`).
- Modify `docs/README.md`: index rows.

**Steps:**
- [ ] **Step 1:** Write the outline, the Q&A and the 03-gateway additions. For every file:line pointer, open the file and confirm the line; record the commit it was checked at.
- [ ] **Step 2:** Run the link check.
- [ ] **Step 3: Commit.**
  - `docs: demo video outline`
  - `docs: interview Q&A and a live dead-upstream capture`

### Task 6.6: Final consistency and verification

**Files:** any doc touched by the fixes; `docs/testing.md` (final counts).

- [ ] **Step 1: Consistency greps**, recording each command and its result:
  - test counts (671 or the new total) are the same everywhere they appear;
  - default values (1024, 50000, `gpt-oss-120b`/`gpt-oss-20b`, 15 tools, ports 3000–3003/8080, `*.localhost`) match `values.yaml` and the code;
  - no "(planned)" for built things;
  - no `example.com`-style placeholder in a command that must run locally.
- [ ] **Step 2: Final verification:**
  - root `npm test` 3× back to back (record the counts);
  - `npm run typecheck`, `npm run lint`, `npm run build`;
  - `scripts\validate-chart.ps1` and both helm lints;
  - `up.ps1 -Redeploy` → all pods 1/1;
  - `scripts\smoke-test.ps1` → all PASS (1 chat turn);
  - the link check over `docs/` and `README.md` → 0 broken;
  - the secret scan of `git diff 8b655b1..HEAD` → 0 real hits;
  - in the master plan, tick the Phase 6 task boxes with pointers.
- [ ] **Step 3: Commit.** `docs: Phase 6 final consistency pass`

---

## Exit criteria

- **Deliverables:** every assignment deliverable exists and is linked from the README, with the assignment checklist mapping each requirement to evidence.
- **The demo script** follows the assignment's definition of done exactly. It was run live at API level (owner-only steps labelled), and it shows the two-user flow, revoke, server disable for both the chat and the external client, the pod kill, and the audit attribution.
- **The two short notes** cover their required points. The stand-out list is honest.
- **The technical docs** have no stale "planned/partial" statuses for built things, and the diagram set is complete, including the Helm resource map.
- **The README** was followed from a fresh clone with every gap fixed. The screenshots are current and secret-free.
- **The demo-video outline and interview Q&A** exist, with checked code pointers.
- **Checks:** all tests and checks pass, the links resolve, and the secret scan is clean.
