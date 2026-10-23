# Deployment guide

> **Status: final (checked 2026-10-23).** The **local (k3d)** deployment of the store is complete and verified: install, upgrade, uninstall/reinstall and a truly fresh install were all run. Phase 2 added the **WooCommerce MCP server** to the chart (namespace `mcp`, internal only) and the image build step that `up.ps1` now runs before every deploy. Phase 3 added the **gateway**, its **Postgres** database, the **Notes** and **Utilities** MCP servers and the `app.localhost` Ingress (`/api` and `/mcp`); `scripts\up.ps1 -Redeploy` deployed them and the checks passed (2026-10-19). Phase 4 added the **dashboard** (its own nginx pod at `app.localhost/`), the chat agent's **LLM settings** and the optional Secret **`llm-api-keys`** (pushed by `scripts\create-secrets.ps1`); deployed with `up.ps1 -Redeploy` and checked with `scripts\check-dashboard.ps1` (2026-10-19). The **production (k3s VPS)** section was written in Phase 5 (2026-10-23): the Helm values, scripts and backup commands were checked as described there, but no real VPS, domain or certificate has been used.
>
> **Rehearsed versus not run (2026-10-23):** the local k3d install, upgrade, reinstall and fresh install were run; the production values were rehearsed on a second local k3d cluster with a self-signed issuer ([Rehearsal results](#rehearsal-results-2026-10-23)). A real VPS, domain, Let's Encrypt certificate, GHCR push, arm64 image and backup restore were **not run**.

Cost: the local deployment uses no paid service and no cloud account; everything runs on your machine in Docker. (The reason production is a VPS and not Vercel/Render is in [ADR-012](decisions/ADR-012-deployment-target-k3s-vps.md).)

Related documents: how the pieces fit together [architecture.md](architecture.md); what each step does internally [workflows.md](workflows.md); when something goes wrong [troubleshooting.md](troubleshooting.md).

## Local (k3d)

### What you are building

A single-node Kubernetes cluster (k3s, running inside a Docker container via k3d) with one Helm release called `urumi` in the namespace `urumi-system`. The release creates the namespaces `store`, `mcp` and `gateway`; today `store` contains MariaDB, WordPress with WooCommerce, an Ingress for `store.localhost`, three generated Secrets, and a one-off Job that configures the shop, and `mcp` contains the three MCP servers (WooCommerce, Notes, Utilities: each one Deployment and a ClusterIP Service, plus the Secrets, **no Ingress**), and `gateway` contains Postgres (StatefulSet with a volume), the gateway (Deployment, Service, ConfigMap, Secrets), the dashboard (Deployment and Service, nginx on port 8080) and the Ingress `gateway` for `app.localhost` (`/api` and `/mcp` to the gateway, `/` to the dashboard). The Secret `llm-api-keys` for the AI chat is **not** created by the chart; you create it with `scripts\create-secrets.ps1` ([step 6b](#step-6b-turn-on-the-ai-chat-optional)).

### Prerequisites

| Tool | Version used | Why | Check |
|---|---|---|---|
| Windows 11 with PowerShell 5.1 | - | The scripts are PowerShell | `$PSVersionTable.PSVersion` |
| Docker Desktop (WSL2 backend), **running** | 4.85.0 | k3d runs the cluster as Docker containers | `docker version` |
| k3d | v5.9.0 | Creates the cluster | `k3d version` |
| kubectl | v1.36.1 | Talks to the cluster | `kubectl version --client` |
| Helm | v4.3.1 | Installs the chart | `helm version` |
| Node.js, then `npm ci` once from the repository root | 24, 24.15 or newer recommended (used: 24.0.1, which works but makes `npm ci` print `EBADENGINE` warnings for jsdom) | Not needed to run anything in the cluster (every image builds inside Docker). Needed for the host-side checks (`check-mcp-woocommerce.ps1`, `check-gateway.ps1`, `check-dashboard.ps1` with `npx playwright install chromium` once) and for `npm test` | `node --version` |
| Free host port 80 (and 443) | - | The cluster publishes them | see [troubleshooting](troubleshooting.md#port-80-is-already-in-use) |

How these were installed on the reference machine, including the WSL2 memory cap, is in [learning/00-setup-log.md](learning/00-setup-log.md). The store's memory limits add up to 1 GiB (MariaDB 512 Mi + WordPress 512 Mi, plus 768 Mi while the setup Job runs), on top of k3s itself, so the 9 GB WSL2 cap in the setup log is ample. Open a **new** terminal after installing a tool so that `PATH` is refreshed.

> **Shortcut.** `scripts\up.ps1` does steps 1 and 3 below in one go (cluster, install if missing, wait) and prints the step 6 URLs; it does not run the step 4 verification and `scripts\stop.ps1` pauses the cluster while keeping the data (verified 2026-10-18). The steps below explain what happens underneath. See the [run guide](run-guide.md) for daily use.

All commands below are run from the repository root. The path contains spaces on the reference machine, which is fine because the scripts quote their paths.

### Step 1. Create or start the cluster

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\cluster-up.ps1
```

**Why:** creates the k3d cluster `urumi` from `deploy/k3d-config.yaml` (host ports 80 and 443 mapped to the cluster), selects the kube context `k3d-urumi`, and waits until the node and Traefik (the ingress controller) are ready. Safe to run again: if the cluster exists it is started.

**Expected:** ends with `Cluster urumi is ready.` and exit code 0. The first run takes a few minutes while images download.

### Step 2. Make `*.localhost` names resolve for every tool

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\setup-hosts.ps1
```

**Why:** browsers and `curl` resolve `*.localhost` to your own machine automatically, but Node-based tools use the operating system resolver and need a line in the Windows hosts file. This script adds `127.0.0.1 store.localhost app.localhost hello.localhost` (once; it is safe to repeat). **Expected:** a UAC prompt (accept it), then `hosts entries present.` If you will only use a browser (or the scripts in this repository, which do not need it: `scripts\check-woo-api.ps1` connects to 127.0.0.1 through a port-forward and uses `store.localhost` only as a string to sign) you can skip this step.

### Step 3a. Build our program images (new in Phase 2; five images since Phase 4)

The three MCP servers, the gateway and the dashboard run from images (`urumi/mcp-woocommerce`, `urumi/mcp-notes`, `urumi/mcp-utilities`, `urumi/gateway`, `urumi/dashboard`, all with the same tag) that are built from this repository and loaded straight into the cluster (there is no registry locally). `up.ps1` does this automatically. If you deploy with `deploy.ps1` yourself, run this first, **before** step 3:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-images.ps1
```

**Why before:** `helm --wait` waits for every workload, including `mcp-woocommerce`, to be Ready, and Helm runs the store-setup Job only after that. If the image is missing, the MCP pod cannot start and the install waits until the timeout. **What it does:** `docker build` with `docker/node-app.Dockerfile` (the Node apps) and `docker/dashboard.Dockerfile` (a Node build stage, then `nginxinc/nginx-unprivileged:1.30.6-alpine` with the static files), `k3d image import` into cluster `urumi`, and a tag file `deploy/.images.local.yaml` (git-ignored) that `deploy.ps1` passes to Helm. The tag is the git short SHA, with `-dirty-<timestamp>` appended when the working tree has any change (even an untracked file); details in the [run guide](run-guide.md#build-the-program-images-build-imagesps1). Without the tag file the chart uses the tag `dev` and the pod cannot start ([troubleshooting](troubleshooting.md#mcp-woocommerce-is-in-errimageneverpull-or-imagepullbackoff)).

### Step 3. Install the store

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\deploy.ps1
```

**Why:** runs `helm upgrade --install urumi charts/urumi-platform -n urumi-system --create-namespace -f deploy/values-local.yaml --wait --timeout 10m` after checking that `helm` and `kubectl` exist and that the current context is `k3d-urumi` (so local settings cannot be applied to another cluster by accident). `--wait` makes Helm block until the workloads are Ready and until the setup Job has finished. **Expected duration:** about one minute with the images already downloaded (67 s on the reference machine for a fresh install), a few minutes the first time.

**Expected output** (trimmed; the status block is printed twice, once by Helm and once by `helm status`):

```text
Deploying release 'urumi' to context 'k3d-urumi' with ...\deploy\values-local.yaml (timeout 10m)...
Release "urumi" does not exist. Installing it now.
NAME: urumi
NAMESPACE: urumi-system
STATUS: deployed
REVISION: 1
DESCRIPTION: Install complete
NOTES:
Release urumi (chart urumi-platform-0.1.0) is deployed in namespace urumi-system.

Namespaces: store, mcp, gateway

Storefront:  http://store.localhost
Store admin: http://store.localhost/wp-admin   (user: admin)

Admin password (PowerShell):
  [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String((kubectl -n store get secret store-admin -o jsonpath='{.data.password}')))

Store setup log:
  kubectl -n store logs job/store-setup
```

If it fails, `deploy.ps1` prints `ERROR: helm upgrade --install failed. Diagnose with: ...`; go to [troubleshooting](troubleshooting.md).

### Step 4. Verify that it works

```powershell
kubectl -n store get pods,pvc,ingress
kubectl -n store logs job/store-setup
```

**Expected:**

```text
pod/mariadb-0                    1/1     Running     0
pod/store-setup-xxxxx            0/1     Completed   0
pod/wordpress-xxxxxxxxxx-xxxxx   1/1     Running     0
persistentvolumeclaim/data-mariadb-0   Bound ... 2Gi   RWO   local-path
persistentvolumeclaim/wordpress-data   Bound ... 2Gi   RWO   local-path
ingress.networking.k8s.io/store   traefik   store.localhost   172.19.0.3   80
```

The exact pod name suffixes and the Ingress address differ on your machine. `RESTARTS` should be 0 on all pods. The setup log ends with `[store-setup] ... SETUP COMPLETE`. Warnings such as `Startup probe failed: HTTP probe failed with statuscode: 500` or `Probe terminated redirects` in `kubectl -n store get events` during the first seconds are normal (see [troubleshooting](troubleshooting.md#probe-warnings-during-first-start)).

The MCP server (namespace `mcp`):

```powershell
kubectl -n mcp get pods,svc                # mcp-woocommerce 1/1 Running; the Service is ClusterIP
kubectl get ingress -A                     # only the store: the MCP server has none
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check-mcp-woocommerce.ps1
```

The check script lists 6 tools and calls a few of them through a temporary port-forward (verified 2026-10-18; details in the [run guide](run-guide.md#8-woocommerce-mcp-server-phase-2)).

Optional checks:

```powershell
curl.exe -s http://store.localhost/shop/        # contains "Urumi Coffee Mug"
curl.exe -s -o NUL -w "%{http_code}" http://store.localhost/cart/   # 200
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check-woo-api.ps1
node --test "scripts/dev/*.test.mjs"
```

`check-woo-api.ps1` ends with `WooCommerce REST API key works (OAuth1, signed with the public store URL).` after printing three lines with HTTP 200, 200 and 401 (the 401 is expected: it proves a wrong signing URL is rejected). The tests report `pass 5`. Do **not** use `node --test scripts/dev/` (directory form): it fails on Node 24.0.1.

### Step 5. Get the admin password

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\get-admin-password.ps1          # copies to the clipboard; add -Show to print
```

The equivalent raw command, which prints the password:

```powershell
[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String((kubectl -n store get secret store-admin -o jsonpath='{.data.password}')))
```

**Why:** the password is generated by Helm on first install and stored only in the Kubernetes Secret `store-admin`; it is never in a file or in Git. Do not paste it into chats or commit it. The user name is `admin`.

### Step 6. Open the store

| URL | What |
|---|---|
| http://store.localhost | The storefront with three sample products (Urumi Coffee Mug, Urumi T-Shirt, Urumi Sticker Pack) |
| http://store.localhost/wp-admin | WordPress admin: log in as `admin` with the password from step 5; WooCommerce → Orders |

Try the checkout: add a product to the cart, open the cart, check out as a guest and choose **Cash on delivery**; then find the order in WooCommerce → Orders. (`/checkout/` with an empty cart redirects to `/cart/`; that is normal.) The flow is explained in [workflows.md](workflows.md#2-shopper-checkout-cash-on-delivery).

The team dashboard is at <http://app.localhost/> (user `admin@example.com`; copy the password with `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\get-secret.ps1 -Namespace gateway -Name gateway-bootstrap -Key password`). Check it in a browser with `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check-dashboard.ps1` (needs `npx playwright install chromium` once); every page is described in the [run guide](run-guide.md#the-dashboard-phase-4).

### Step 6b. Turn on the AI chat (optional)

The chat needs a free Groq API key. Put it in the git-ignored `.env` as `GROQ_API_KEY=...` (copy `.env.example` to `.env` first), then:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\create-secrets.ps1
```

**Why a script and not Helm:** the key is yours, not generated, and must never be in a values file. The script reads only `GROQ_API_KEY` and `OPENROUTER_API_KEY` from `.env`, prints `set` or `empty`, creates the Secret `llm-api-keys` in namespace `gateway` with server-side apply (so no plaintext copy lands in an annotation) and restarts the gateway. **Expected:** `secret/llm-api-keys serverside-applied` and `deployment "gateway" successfully rolled out`, then the gateway log line `llm configured: groq/openai/gpt-oss-120b` (verified 2026-10-19). Without the Secret everything else works and the Chat page says it is not configured. Step by step for beginners: the run guide's [Set up the AI chat](run-guide.md#set-up-the-ai-chat); providers, models and limits: [ai-integration.md](ai-integration.md).

### Step 7. Upgrade (change settings or the chart)

Edit `deploy/values-local.yaml` (or the chart), then run the same command again:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\deploy.ps1
```

Helm creates a new revision. Passwords and data are unchanged (the chart re-reads the existing Secrets), and the setup Job runs again and finds nothing to change. Watch out for one limit: **MariaDB's storage size cannot be changed after the first install** (see [troubleshooting](troubleshooting.md#changing-mariadbstorage-fails-on-upgrade)); set `mariadb.storage` before the first install.

### Step 8. Roll back

```powershell
helm history urumi -n urumi-system
helm rollback urumi <revision> -n urumi-system --wait
```

**Why:** `helm history` lists revisions with their status; `helm rollback` re-applies an earlier revision's manifests. Rollback was **not exercised** in Phase 1 (only the commands are documented, from Helm's documented behavior). Notes: the setup Job is a `post-install,post-upgrade` hook, so it does not run on a rollback; and rolling back never touches the data volumes.

### Step 9. Uninstall (and what is kept)

```powershell
helm uninstall urumi -n urumi-system
```

**Kept on purpose** (so a mistaken uninstall cannot destroy the store): the namespaces `store`, `mcp`, `gateway`; the PVCs `wordpress-data` and `data-mariadb-0`; the Secrets `store-db`, `store-admin`, `store-woo-api`. **Removed:** the WordPress Deployment, MariaDB StatefulSet, Services, Ingress and ConfigMap. The finished `store-setup` Job and its Pod may remain; they are harmless and are replaced on the next deploy. The Secret `llm-api-keys` is not part of the Helm release at all (the script created it), so uninstall leaves it in place (**expected**); only deleting the `gateway` namespace removes it.

**Reinstall:** run `scripts\deploy.ps1` again with the same release name and namespace. Helm adopts the kept objects and the store comes back with its data (verified on the reference machine, 2026-10-18: the setup log said `WordPress already installed` and `products already present (3); not seeding`).

**Delete the data for real:**

```powershell
helm uninstall urumi -n urumi-system
kubectl delete ns store mcp gateway --wait=true --timeout=300s
kubectl get pv      # should print: No resources found
```

> **This destroys all store data: products, orders, users, uploads, and the generated passwords.** The next `deploy.ps1` creates a brand-new store with new credentials. It is the right way to "start over" and was tested this way (a truly fresh install succeeded on the first setup-Job attempt). To remove the whole cluster instead, run `scripts\cluster-down.ps1` (also destroys everything); to pause, `scripts\stop.ps1` (`k3d cluster stop urumi`) keeps the data (verified 2026-10-18) and `scripts\up.ps1` resumes.

### Step 10. If host port 80 is taken: use 8081

**Not tested end to end** in Phase 1 (the chart renders it, the steps below are the intended procedure).

1. In `deploy/k3d-config.yaml` change `- port: 80:80` to `- port: 8081:80`.
2. In `deploy/values-local.yaml` set `publicPort: 8081`. The chart then builds every public URL as `http://store.localhost:8081` (`WP_HOME`, the Ingress host stays `store.localhost`).
3. Recreate the cluster (port mappings cannot be changed on a running cluster by this procedure): `scripts\cluster-down.ps1`, then `scripts\cluster-up.ps1`, then `scripts\deploy.ps1`. This deletes existing data.
4. Use `http://store.localhost:8081`. Known gap: `scripts\check-woo-api.ps1` derives its signing base from the Ingress host only and omits the port, so on 8081 it would need `--sign-base http://store.localhost:8081`.

### Pre-created Secrets (advanced, mostly for production)

By default the chart generates the Secrets. To supply your own, they must exist in namespace `store` before the install, but the chart also **owns** the namespace `store` (and `mcp`, `gateway`). A plain `kubectl create namespace store` would therefore make the first install fail with "exists and cannot be imported". Create the namespace **with Helm's ownership metadata** so that Helm adopts it. Adoption was **verified on 2026-10-23** in the production rehearsal: `scripts/prod/create-prod-secrets.sh` wrote this metadata on all three namespaces, and `helm upgrade --install` adopted them. The three commands below write the same metadata by hand; they were not run as typed.

```powershell
kubectl create namespace store
kubectl label namespace store app.kubernetes.io/managed-by=Helm
kubectl annotate namespace store meta.helm.sh/release-name=urumi meta.helm.sh/release-namespace=urumi-system
# now create the Secrets in that namespace, e.g.:
kubectl -n store create secret generic store-admin --from-literal=password=<your-password>
```

(Do the same for `mcp` and `gateway`: the `storeWooApi`, `mcpWoocommerceToken`, `mcpNotesToken` and `mcpUtilitiesKey` Secrets also live in `mcp`, and the gateway Secrets and the copies of the three upstream credentials live in `gateway`, see the `storeWooApi` and `mcpWoocommerceToken` rows in the table below.) Then name the Secrets in the values file under `secrets.existing`:

| Values key | Secret keys required | Notes |
|---|---|---|
| `storeDb` | `root-password`, `password` | MariaDB root and application passwords. They must match the data already on the volume. |
| `storeAdmin` | `password` | WordPress admin password. The key must be named exactly `password`. |
| `storeWooApi` | `consumer-key`, `consumer-secret` | The consumer secret must be at most **43 characters** (WooCommerce stores it in a `char(43)` column). The chart's own generated secret is `cs_` plus 40 characters = 43. **The same Secret must also exist in namespace `mcp`** (the MCP server reads it there; with `storeWooApi` set the chart renders no copy). |
| `mcpWoocommerceToken` | `token` | The bearer token of the MCP server, in namespace `mcp` (at least 16 characters; the generated one is 48). **A byte-identical copy must also exist in namespace `gateway`** (used to seed the registry). |
| `mcpNotesToken` | `token` | The bearer token of `mcp-notes`, in `mcp`, with a copy in `gateway`. |
| `mcpUtilitiesKey` | `key` | The key of `mcp-utilities` (header `X-Utilities-Key`), in `mcp`, with a copy in `gateway`. |
| `gatewaySecrets` | `postgres-password`, `encryption-key`, `internal-token-secret` | Namespace `gateway`. `encryption-key` must be base64 of exactly 32 bytes (the gateway refuses to start otherwise); `internal-token-secret` at least 32 characters. Losing the encryption key makes stored upstream credentials unreadable. |
| `gatewayBootstrap` | `email`, `password` | Namespace `gateway`. The first admin account, used only when the gateway database has no users. |
| `llmApiKeys` | `GROQ_API_KEY`, `OPENROUTER_API_KEY` | Namespace `gateway`. **Never generated by the chart**, locally or in production. `deploy/values-prod.yaml` names it `llm-api-keys`; it is referenced with `optional: true`, so a missing Secret leaves the gateway running with the chat "not configured". An empty value means that provider is not configured. Create it on the server without putting the key on the command line or in shell history, for example from a file you delete afterwards: `kubectl -n gateway create secret generic llm-api-keys --from-file=GROQ_API_KEY=./groq.txt --from-literal=OPENROUTER_API_KEY=` (**not tested on a VPS**). `scripts\create-secrets.ps1` does the same from a Windows machine whose kube context points at the cluster, but it always uses the name `llm-api-keys`. After changing it, restart the gateway: `kubectl -n gateway rollout restart deploy/gateway`. |

The chart renders the generated copies identically in both namespaces (checked with `helm template`). The pre-created variant, gateway Secrets included, was exercised in the production rehearsal of 2026-10-23: `create-prod-secrets.sh` created every Secret and `helm upgrade --install` used them. All pods became ready, and the bootstrap admin could log in ([Rehearsal results](#rehearsal-results-2026-10-23)). It was not run on a VPS. For production, the dashboard needs nothing extra: its image is pulled from the registry like the others (`<registry>/urumi/dashboard:<tag>`) and it is served on the same host as the API (`global.appHost`), which keeps the cookie and CSRF model unchanged ([ADR-015](decisions/ADR-015-dashboard-served-by-nginx.md)). The rehearsal served the dashboard this way (HSTS header present); **not tested on a VPS**.

`deploy/values-prod.yaml` already names these Secrets and points to this procedure. It also has two placeholders for our own images, `global.imageRegistry` and `global.imageTag` (both `CHANGE-ME`): production pulls `<registry>/urumi/mcp-woocommerce:<tag>` from a real registry instead of importing it. Building and pushing the images is described in [Production, step 6](#6-build-and-push-multi-arch-images-not-executed) and is **not executed**; the local import workflow is the one exercised. `scripts/prod/create-prod-secrets.sh` creates all these Secrets for you.

The WooCommerce key owner is the `urumi-mcp` shop manager that the setup Job creates; see [run guide, section 8](run-guide.md#who-owns-the-woocommerce-api-key-security-note). **Upgrade note:** a store upgraded from Phase 1 (`main`) never had a `urumi-mcp` user (the key was owned by `admin` then), so the Job creates and marks the user and the upgrade needs nothing from you. Only a store installed from the intermediate Phase 2 commit that predates the key-owner fix has an unmarked `urumi-mcp` user, and there the setup Job refuses to reuse it until you add the marker ([troubleshooting](troubleshooting.md#the-store-setup-job-fails-with-missing-urumi_managed_key_owner-marker)).

### Known limitation: rotating a pre-created WooCommerce key Secret

The MCP server pod carries a `checksum/secrets` annotation: a hash of the key values **as the chart generates them**. Kubernetes only reads a Secret into a container's environment when the container starts, so a changed key needs a pod restart, and the annotation is what normally triggers one on the next deploy. When you use your own Secret (`secrets.existing.storeWooApi`, as in production), the chart cannot see its values, so the annotation is a hash of the Secret's **name** only. That keeps it stable, so upgrades do not restart the pod for nothing (two `helm template` runs with `--set secrets.existing.storeWooApi=foo` gave the same annotation; verified 2026-10-19), but it also means **rotating the Secret does not restart the pod automatically**: the pod keeps running with the old key (WooCommerce then answers 401 until restart). After rotating, restart it yourself:

```powershell
kubectl -n mcp rollout restart deploy/mcp-woocommerce
```

The same applies to a rotated `mcp-woocommerce-token` Secret. This follows from how the template is written (checked in the chart); it was not exercised with a real pre-created Secret.

### Rolling out, health checks and logs (quick reference)

| Need | Command |
|---|---|
| Is everything running? | `kubectl -n store get pods` |
| Why is a Pod not ready? | `kubectl -n store describe pod <name>` and `kubectl -n store get events --sort-by=.lastTimestamp` |
| WordPress logs | `kubectl -n store logs deploy/wordpress -c wordpress` |
| MariaDB logs | `kubectl -n store logs mariadb-0` |
| Setup Job log | `kubectl -n store logs job/store-setup` |
| MCP server status and logs | `kubectl -n mcp get pods,svc` and `kubectl -n mcp logs deploy/mcp-woocommerce` (also `mcp-notes`, `mcp-utilities`) |
| Gateway and Postgres status | `kubectl -n gateway get pods,svc,ingress` |
| Gateway and Postgres logs | `kubectl -n gateway logs deploy/gateway` and `kubectl -n gateway logs postgres-0` |
| Gateway end-to-end check | `scripts\check-gateway.ps1` (add `-Write`, `-Isolation`); see the [run guide](run-guide.md#9-the-gateway-phase-3) |
| Dashboard status, logs and check | `kubectl -n gateway get pods`, `kubectl -n gateway logs deploy/dashboard`, `scripts\check-dashboard.ps1` |
| Is the AI chat configured? | `kubectl -n gateway get secret llm-api-keys -o name` and `kubectl -n gateway logs deploy/gateway \| Select-String "llm "` |
| Release state | `helm status urumi -n urumi-system`, `helm history urumi -n urumi-system` |
| What values are in use? | `helm get values urumi -n urumi-system` |

### Pod security and WordPress file changes (Phase 5)

- The chart labels the `store`, `mcp` and `gateway` namespaces with Pod Security `restricted` (`podSecurity.level`, [ADR-017](decisions/ADR-017-pod-security-restricted.md)). Any pod you add there must comply.
- **`MARIADB_ROOT_HOST=localhost` applies only on the first initialisation of an empty data directory.** An existing MariaDB volume keeps the root accounts it already has, so upgrading a running cluster does not change them (verified 2026-10-22: the variable is set on the pod, but the existing data directory was not re-initialised). A fresh install is where it takes effect: on the fresh local install of 2026-10-23 (Task 5.8) `mysql.user` held only `root` at `localhost` ([security.md, section 8.5](security.md#85-pod-security-phase-5-task-54)).
- **`DISALLOW_FILE_MODS` is on**, so plugins and themes cannot be installed, updated or deleted from wp-admin. They change only through the store-setup Job and the image tag.
- **The WordPress image tag pins only the first core copy** into the `wordpress-data` volume (the `copy-wordpress` initContainer copies core once). Later core updates are not applied by changing the tag.
- `helm lint` rejects hostnames that are not lower-case DNS names, an empty or malformed `storeSetup.timezone`, and `tls.enabled: true` with `publicScheme: http`. Run `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\validate-chart.ps1` to check the rules.

### Image pull limits and the WooCommerce download (Phase 5)

- **Docker Hub anonymous pull limits.** Most images (wordpress, mariadb, postgres, the WP-CLI image) come from Docker Hub. Anonymous pulls are rate limited per source IP (check Docker's current limits page for the numbers). A fresh cluster on a shared or NATed address can hit `429 Too Many Requests` and pods stay in `ImagePullBackOff`. Locally the images are pulled once and cached; on a VPS, log in to Docker Hub for the node's containerd or mirror the images to your own registry. Not tested here.
- **Fresh installs depend on `downloads.wordpress.org`.** The store-setup Job downloads `woocommerce.11.2.1.zip` from it (the NetworkPolicy allows the Job out on 80 and 443 for this). If it is unreachable the Job fails and retries (`backoffLimit: 3`); see [troubleshooting](troubleshooting.md#the-store-setup-job-failed). A redeploy that finds WooCommerce already at or above `woocommerceVersion` downloads nothing.

### Local limitations

- Single node, single replica for every component; no backups and no high availability.
- The `local-path` storage lives inside the k3d node container: it survives pod restarts and `helm uninstall` (both verified), and survives `k3d cluster stop` (verified 2026-10-18), but not `cluster-down.ps1`.
- No TLS locally (plain HTTP), and no mail server, so WooCommerce e-mails are not delivered.
- The cluster needs internet access for image pulls and for downloading WooCommerce 11.2.1 during setup, and the gateway needs it for the AI chat (Groq's free plan: about 8,000 tokens per minute, roughly two chat questions a minute for the whole team; see [ai-integration.md](ai-integration.md#5-limits-and-token-budget)).

## Using a WooCommerce store hosted elsewhere

Phase 5b (Task 5b.5, [ADR-019](decisions/ADR-019-external-woocommerce-store.md)). The WooCommerce MCP server can talk to a store that is not installed by this chart. It then uses **HTTP Basic over HTTPS** (the consumer key as user name, the consumer secret as password). **Verified 2026-10-23:** the MCP server in this mode against the local WooCommerce 11.2.1 over HTTPS with TLS verification on (`scripts\dev\test-external-store.ps1`). **Rendered, not installed:** the chart's external mode was rendered and linted but not installed on a cluster. A real remote store is **not tested**.

1. **Create the REST key on that store.** In its admin: WooCommerce > Settings > Advanced > REST API > Add key. Choose a user that may manage the shop (a shop manager is enough) and the permission **Read/Write**. WooCommerce shows the key and secret once.
2. **Create the Secret in the `mcp` namespace.** Put the two values in files that are not in the repository, create the Secret from the files, then delete them. Write each file with **no trailing newline and no BOM**: in Windows PowerShell 5.1, `echo x > ck.txt` writes UTF-16 with a line break, and those extra bytes end up in the Basic-auth header (the store then answers 401). `Read-Host -AsSecureString` asks for the value without showing it, so nothing is echoed or kept in the command history:

   ```powershell
   function Write-SecretFile([string]$Path, [string]$Prompt) {
     $s = Read-Host -AsSecureString $Prompt
     $p = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
     try { [IO.File]::WriteAllText($Path, [Runtime.InteropServices.Marshal]::PtrToStringBSTR($p)) }   # UTF-8, no BOM, no newline
     finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p) }
   }
   Write-SecretFile "$PWD\ck.txt" 'Consumer key'
   Write-SecretFile "$PWD\cs.txt" 'Consumer secret'
   kubectl -n mcp create secret generic my-store-woo --from-file=consumer-key=.\ck.txt --from-file=consumer-secret=.\cs.txt
   Remove-Item .\ck.txt, .\cs.txt
   ```

   The commands contain no secret values. Since the Phase 5b review the MCP server also trims spaces, line breaks and a BOM from both values (**tested**: `apps/mcp-woocommerce/test/server.test.ts`), so a file with a trailing newline no longer breaks it; writing the file cleanly is still the safe habit. **Checked 2026-10-23:** the file-writing part of `Write-SecretFile`, with a dummy value passed in place of the prompt, wrote exactly the value's 19 bytes (no BOM, no line break). The interactive prompt and creating a Secret this way against a real store are **not tested**.

   The key names must be exactly `consumer-key` and `consumer-secret`. The chart owns the namespace `mcp`: on a first install create it with Helm's ownership metadata as described under [Pre-created Secrets](#pre-created-secrets-advanced-mostly-for-production), or install first and create the Secret afterwards (the MCP pod then waits with `CreateContainerConfigError` until it exists).
3. **Set the values** (a values file, for example appended to `deploy/values-prod.yaml`):

   ```yaml
   store:
     enabled: false              # omit it to keep the in-cluster store as well
   mcpWoocommerce:
     externalStore:
       url: https://shop.example.com        # https only, no user name or password in it
       existingSecret: my-store-woo         # the Secret from step 2
       extraEgressCIDRs: []                 # see "Private-network stores" below
   storeSetup:
     timezone: Europe/Berlin                # the time zone of THAT store
   ```

   The chart refuses to render an `http://` URL, a URL containing `user@` or `user:pass@`, a missing `existingSecret`, or `store.enabled: false` without a URL.
4. **Time zone.** `today`, `yesterday` and `last_7_days` in `list_orders` are computed in `STORE_TIMEZONE`, which the chart takes from `storeSetup.timezone`. Set it to the external store's own time zone (WooCommerce > Settings > General or Settings > General in WordPress), or those periods start at the wrong midnight.
5. **After rotating the key**, restart the pod, because it reads the Secret only at start: `kubectl -n mcp rollout restart deploy/mcp-woocommerce`.

**What `store.enabled: false` skips.** Everything in the `store` namespace and the namespace itself: WordPress, MariaDB, the `store-setup` Job, the `wp-cron` CronJob, the store Ingress, the store Secrets (`store-db`, `store-admin`, `store-woo-api` and its copy in `mcp`), the store NetworkPolicies (default-deny, DNS, WordPress, MariaDB, wp-cron, solver) and, with TLS on, the store's redirect and HSTS Middlewares. The `mcp` and `gateway` namespaces, their policies, the other MCP servers, the gateway and the dashboard are rendered as before. The helper scripts for the local cluster (`up.ps1`, `check-mcp-woocommerce.ps1`, `get-admin-password.ps1`) assume the in-cluster store.

**Egress.** With an external URL the `mcp-woocommerce` pod may reach the public internet on ports 443 and 80, with the private and special-use ranges excluded (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `100.64.0.0/10`, `127.0.0.0/8`), the same rule the gateway uses. It no longer has the rule to the in-cluster WordPress. Rendered, not tested against a real remote address.

**Private-network stores.** If the store is on a private address (a VPN, a peered network), the internet rule excludes it. List its network under `extraEgressCIDRs` (IPv4 CIDRs such as `10.20.0.0/24`); each entry opens TCP 443 only. Keep the entries as narrow as possible: `10.0.0.0/8` would also open the cluster's own pod and service networks to that pod.

**HTTPS only.** Basic sends the secret with every request, so the MCP server and the chart both refuse anything but `https://` in this mode ([security, section 17](security.md#17-an-external-woocommerce-store-phase-5b)). The certificate must be valid for the host and signed by a public CA; the server does not skip verification.

**If the store answers 401 or 403**, see [troubleshooting](troubleshooting.md#the-external-store-answers-401-or-403-or-the-mcp-server-cannot-reach-it): some hosts strip the `Authorization` header before it reaches WordPress.

## Registering MCP servers that run inside the cluster

Phase 5b (Task 5b.6, [ADR-016 addendum](decisions/ADR-016-default-deny-network-policies.md#addendum-phase-5b-gatewayinternalupstreams)). The gateway reaches the three built-in MCP servers out of the box. An admin can also add another server that runs in this cluster (dashboard Servers > Add server, or `POST /api/servers`), but two guards block it until the chart is told about it: the gateway's SSRF allow-list (`SSRF_ALLOWED_INTERNAL_HOSTS`, default `*.mcp.svc.cluster.local`) and the default-deny NetworkPolicies. The chart value `gateway.internalUpstreams` opens both, one entry per server:

```yaml
gateway:
  internalUpstreams:
    - namespace: tools                       # a DNS label: the namespace the server's Service lives in
      port: 3010                             # 1-65535: the TCP port the pod listens on
      podLabels:                             # optional: only pods with these labels; omit it for every pod in the namespace
        app.kubernetes.io/name: my-mcp-server
```

What each entry changes (an empty list, the default, renders exactly the objects of the release before Phase 5b):

| Where | Effect |
|---|---|
| Gateway env `SSRF_ALLOWED_INTERNAL_HOSTS` | `*.<namespaces.mcp>.svc.cluster.local` plus `*.<namespace>.svc.cluster.local` for each unique namespace, comma-joined. It lets the URL `http://<service>.<namespace>.svc.cluster.local:<port>/mcp` through the SSRF guard; nothing else. |
| NetworkPolicy `gateway` (namespace `gateway`) | One more egress rule: to that namespace (`kubernetes.io/metadata.name`), to the pods matching `podLabels` when given, on TCP `port` only. |
| NetworkPolicy `mcp-internal-upstream-<n>` (namespace `mcp`) | Rendered only when `namespace` equals `namespaces.mcp` (default `mcp`): ingress to the pods matching `podLabels` (all pods when omitted) from the gateway pods only, on TCP `port`. |
| Any other namespace | **Not touched.** Create the workload and its Service yourself; if that namespace has a default-deny policy, add a policy of your own that admits the pods labelled `app.kubernetes.io/name=gateway` from the namespace `gateway` on that port. A namespace without a policy needs nothing. |

Rules and limits:

- Do not list system namespaces: each entry lets the gateway reach that namespace's pods on the port you give. The chart refuses `kube-system`, `kube-public` and `kube-node-lease` (schema) and the gateway's own namespace, `namespaces.gateway`, where Postgres runs (template `fail`); **tested** by `scripts\validate-chart.ps1`. Other namespaces that are not yours, such as `default`, are not checked: leave them out.
- The pod must speak the MCP Streamable HTTP protocol on the given port. The gateway still applies the SSRF guard to the resolved address (loopback and link-local stay refused), and the new egress rule is limited to the one port you list.
- Apply the value with `scripts\up.ps1 -Redeploy` (put it in your values file), then add the server: dashboard Servers > Add server with the URL `http://<service>.<namespace>.svc.cluster.local:<port>/mcp`. Step by step: [run guide](run-guide.md#add-an-mcp-server-that-runs-inside-the-cluster).
- The schema rejects a `port` outside 1-65535, a `namespace` that is not a DNS label (for example `Bad_NS`), an entry without a port, unknown keys and non-string label values.
- Policies are enforced a few seconds after a pod starts (see [security, section 15](security.md#15-networkpolicies-phase-5)); a refresh right after a deploy can still say `connection refused`.

**Verified on 2026-10-23** (local k3d, k3s v1.35.5): `scripts\validate-chart.ps1` (render rows for the empty list, an entry in `mcp`, an entry in another namespace, duplicates and the schema rejections) and the live proof `scripts\dev\test-internal-upstream.ps1`, which deploys a test server in `mcp` and another in a new namespace `tools-test`, shows both refused or unreachable before the setting and connected with 4 tools after it, makes one `tools/call` through a temporary API key, and removes everything. Results: [security, section 15](security.md#15-networkpolicies-phase-5).

## When the public address changes

Say the store moves from `store.localhost` to `store.example.com` (or the dashboard and gateway from `app.localhost` to a real name). You change `global.storeHost` and `global.appHost` in your values file and run `scripts\up.ps1 -Redeploy` (or `helm upgrade`). This is what follows by itself and what does not:

| Thing | Automatic? | Action |
|---|---|---|
| Product links | yes | follow `global.storeHost` |
| Existing media and content links | not automatic | the one-off `wp search-replace 'http://store.localhost' 'https://store.example.com' --skip-columns=guid` |
| Dashboard endpoint | yes | shown from the browser address |
| Gateway hosts, CSRF origin and invite links | yes | from `global.appHost` |
| MCP clients' saved URL | no | each user re-adds it once (keys keep working) |
| Upstream server addresses | unaffected | internal names |
| External store | not applicable | its own domain ([a store hosted elsewhere](#using-a-woocommerce-store-hosted-elsewhere)) |

Notes on the rows:

- **Existing links.** Pages, posts and uploaded media store their absolute addresses in the database, so old content keeps pointing at the old address until you rewrite it. `--skip-columns=guid` leaves post GUIDs alone: they are identifiers, not links, and WordPress advises against changing them. Take a backup first ([backups](#12-backups)), then run the command inside a one-off pod made from the **`wp-cron` CronJob's pod template**: it has WP-CLI (`wordpress:cli`), the WordPress volume, the database settings (the password comes from the Secret by reference, it is never copied) and the labels the MariaDB NetworkPolicy admits, and it passes the `restricted` Pod Security level. Run it once, after the DNS name and TLS work.
- **The steps** (PowerShell, from any folder, on the cluster's context). The first command copies the template and replaces only the container command with `sleep 900`, so the pod waits for you:

  ```powershell
  $t = (kubectl -n store get cronjob wp-cron -o json | ConvertFrom-Json).spec.jobTemplate.spec.template
  $t.spec.containers[0].command = @('sleep', '900')
  $pod = @{ apiVersion = 'v1'; kind = 'Pod'; metadata = @{ name = 'wp-search-replace'; namespace = 'store'; labels = $t.metadata.labels }; spec = $t.spec }
  $pod | ConvertTo-Json -Depth 30 | kubectl apply -f -
  kubectl -n store wait --for=condition=Ready pod/wp-search-replace --timeout=120s
  # 1) Dry run: shows the counts per table, writes nothing
  kubectl -n store exec wp-search-replace -- wp --path=/var/www/html search-replace 'http://store.localhost' 'https://store.example.com' --skip-columns=guid --dry-run --report-changed-only
  # 2) For real, after the backup: the same command without --dry-run
  kubectl -n store exec wp-search-replace -- wp --path=/var/www/html search-replace 'http://store.localhost' 'https://store.example.com' --skip-columns=guid --report-changed-only
  kubectl -n store delete pod wp-search-replace
  ```

  Put your own old and new addresses in both commands. If the pod is not deleted, it ends by itself after 900 seconds (it stays `Completed` until you delete it).
- **Verified 2026-10-23 on the local store** (WooCommerce 11.2.1): the steps above with the dry run (1), then the delete. Output: `wp_options option_value 3`, `wp_posts post_content 2`, `wp_users user_url 1`, `Success: 6 replacements to be made.`; the pod was created, became Ready and was deleted, and the store's pods were the same before and after. No values were printed. (An earlier dry run in Task 5b.7 used a pod copied by hand from the same `wp-cron` pod spec, with the same result.) **Not executed:** the real run (2).
- **MCP clients.** A client stores the full gateway URL, so after the change each user runs `claude mcp remove urumi-gateway` and adds it again with the new address, or changes `URUMI_GATEWAY_URL` for a `.mcp.json` ([run guide](run-guide.md#connect-claude-code)). Keys are stored in the gateway by hash and do not depend on the address.
- **Registered MCP servers.** The gateway reaches them by cluster-internal names (`mcp-woocommerce.mcp.svc...`), which do not change with the public address.

## Production (k3s VPS)

> **Status (2026-10-23).** This guide installs the same chart on one k3s server with TLS. **No real VPS, domain or Let's Encrypt certificate has been used.** What *was* run is marked **verified**; everything else is **not executed** (it needs your cloud account, domain or registry) or **expected** (taken from the tools' documentation). Task 5.7 of Phase 5 rehearses the cluster side on a second local k3d cluster with a self-signed issuer; its results are recorded in [ADR-012](decisions/ADR-012-deployment-target-k3s-vps.md) and the [testing guide](testing.md).

**Contents:** [Verified so far](#verified-so-far) · [1. Choose a server](#1-choose-a-server) · [2. Install k3s](#2-install-k3s) · [3. DNS](#3-dns-records) · [4. Traefik settings](#4-traefik-keep-the-real-client-ip) · [5. cert-manager and the issuer](#5-cert-manager-and-the-certificate-issuer) · [6. Build and push images](#6-build-and-push-multi-arch-images-not-executed) · [7. Create the Secrets](#7-create-the-secrets) · [8. Install](#8-install-the-chart) · [9. Verify](#9-verify-the-site) · [10. Logs](#10-logs) · [11. Upgrade and roll back](#11-upgrade-and-roll-back) · [12. Backups](#12-backups) · [13. Helm release Secret exposure](#13-the-helm-release-secret-note)

### Verified so far

| What | Result (2026-10-23) |
|---|---|
| `helm lint` with `deploy/values-prod.yaml` | passes |
| `helm template -f deploy/values-prod.yaml` through `kubeconform` v0.8.0 (`-strict -ignore-missing-schemas -kubernetes-version 1.35.0`, run by `scripts\validate-chart.ps1`) | 48 resources: 44 valid, 0 invalid, 0 errors, 4 skipped (after the Phase 5 final review added the solver policies and the `wp-cron` CronJob and policy). The 4 skipped are the Traefik `Middleware` objects: **kubeconform has no schema for custom resource kinds, so they are skipped, not validated.** The local values: 54 resources, all valid. |
| The prod render contains a `redirect-https` and an `hsts` Middleware in `store` and in `gateway`, and both Ingresses carry the `router.middlewares` annotation; the local render has neither | passes (`validate-chart.ps1`) |
| The prod render contains the NetworkPolicy `acme-http01-solver` (Traefik to cert-manager's HTTP-01 solver on 8089) in `store` and `gateway`; the local render has none | passes (`validate-chart.ps1`); its effect was checked on the local cluster with a stand-in solver pod ([ADR-016](decisions/ADR-016-default-deny-network-policies.md)) |
| `scripts/prod/create-prod-secrets.sh` on a throw-away k3d cluster (from Git Bash): creates the namespaces with Helm ownership metadata and all Secrets; a second run reports every Secret `kept`; a deleted `mcp` copy is re-created byte-identical to the `gateway` copy; the WooCommerce key and secret are 43 characters; the encryption key decodes to 32 bytes; nothing secret is printed. `shellcheck` v0.11.0 is clean. | passes |
| The backup commands in [12. Backups](#12-backups) against the **local** cluster | both produce a non-empty dump (sizes there) |
| The official WordPress image already trusts `X-Forwarded-Proto` ([step 9](#9-verify-the-site)) | verified in the running pod |
| The redirect and HSTS headers on the wire on the rehearsal cluster (self-signed certificate, `:8443`) | passes ([Rehearsal results](#rehearsal-results-2026-10-23)) |
| A real install on a VPS, DNS, a real (Let's Encrypt) certificate, the redirect and HSTS on a real domain, GHCR pushes, multi-arch images, restores | **not executed** |

### Rehearsal results (2026-10-23)

The production values were installed into a **temporary second k3d cluster** (`urumi-prod`, one node) with `scripts\prod-rehearsal.ps1`. This is a rehearsal, not a VPS: it proves the chart, `values-prod.yaml`, the Secrets script, cert-manager wiring, Pod Security `restricted`, the NetworkPolicies and the TLS Middlewares work together on a brand-new cluster. It does **not** prove anything about DNS, Let's Encrypt, a public IP, GHCR pulls, multi-arch images, `externalTrafficPolicy: Local` with a real client IP, or resource pressure on a 2 OCPU VM.

How it was run (the local cluster `urumi` was stopped meanwhile and started again afterwards; its data was not touched):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\prod-rehearsal.ps1 -Up       # stop urumi, create urumi-prod, cert-manager v1.21.2, Secrets, images, helm install
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\prod-rehearsal.ps1 -Verify   # PASS/FAIL rows
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\prod-rehearsal.ps1 -Down     # delete urumi-prod, start urumi
```

Settings that differ from production (`deploy/values-prod-test.yaml`): hosts `store.prod.localhost` / `app.prod.localhost`, `publicPort: 8443`, the `selfsigned` ClusterIssuer, `imageRegistry: ""` with the images built from the repository and imported (`scripts\build-images.ps1 -Cluster urumi-prod`), smaller requests and volumes. The cluster maps host `127.0.0.1:8081 -> 80` and `127.0.0.1:8443 -> 443`. **Port 8080 was planned but an Apache `httpd` already listened on it**, so the first `k3d cluster create` failed and the plan was changed to 8081.

| Check | Result |
|---|---|
| `helm upgrade --install` with `values-prod.yaml` + `values-prod-test.yaml` (`--wait --timeout 15m`) | passed. First install: the gateway restarted twice because its database was not ready within about 60 s (Postgres was still pulling its image on the new cluster; root cause found in Task 5.8 and fixed by lengthening the database wait to 90 x 2 s and the startup probe to 110 x 2 s), then became ready by itself. |
| All 8 long-running pods in `store`, `mcp`, `gateway` ready, namespaces enforce `restricted` | PASS (8 running, 3 of 3 namespaces `restricted`) |
| `kubectl get certificate -A` | PASS: `gateway/urumi-tls-app` and `store/urumi-tls-store` both `Ready=True` (self-signed) |
| `http://store.prod.localhost:8081/` and `http://app.prod.localhost:8081/` | PASS: `301` to `https://store.prod.localhost:8443/` and `https://app.prod.localhost:8443/` (after the fix below) |
| `https://store.prod.localhost:8443/` | PASS: `200` with `Strict-Transport-Security: max-age=31536000`; the dashboard also sends HSTS |
| `GET /api/auth/me` without a login | PASS: `401` JSON (`UNAUTHENTICATED`) |
| Store HTML over https | PASS: 0 occurrences of `http://store.prod`, 44 lines with `https://store.prod.localhost:8443` (no mixed content) |
| Login through the API with the bootstrap admin (password read from the Secret, never printed) | PASS: `200`, the one `Set-Cookie` has `Secure` (and `HttpOnly`) |
| `GET /api/chat/status` after login | PASS: `configured:false` (no LLM key Secret was created) |
| `scripts\test-network-policies.ps1` on the rehearsal cluster | PASS: 13 of 13 probes (after the probe fix below) |
| `scripts\check-gateway.ps1 -Base https://app.prod.localhost:8443` with `NODE_EXTRA_CA_CERTS` set to the app certificate | PASS: login, API key, 15 tools, revoked key `401`, audit rows. Node resolved `*.prod.localhost` itself. |
| `scripts\check-dashboard.ps1`, `check-mcp-woocommerce.ps1`, `-Write` / `-Isolation` variants, a browser against the self-signed certificate | **not run** on the rehearsal cluster (they target `http://*.localhost` on the local cluster) |
| Let's Encrypt issuance, a real domain, GHCR image pulls, multi-arch images, real client IP, backups and restores on the rehearsal | **not run** (needs a VPS or was out of scope) |

**Failures found and fixed** (each one its own commit):

1. **`fix(helm): https redirect keeps a non-default public port`.** The `redirect-https` Middleware had no port, so Traefik answered even an https request on `:8443` with `301 https://host/` (it rewrites the URL without the port), and every page, API call and login became a redirect to a port that is not published. Production on 443 was never affected; any `publicPort` other than 443 was. The Middleware now carries `port: "<publicPort>"` when that is not 443, and `scripts\validate-chart.ps1` checks both cases. Because of this fix the plain-http redirect on the rehearsal cluster goes to `https://store.prod.localhost:8443/` (before it, Traefik returned `301 https://store.prod.localhost/` with no port).
2. **`fix: network policy probe sends X-Forwarded-Proto ...`.** With TLS on, WordPress answers a plain-http `wp-login.php` with `302` (to https) instead of `200`, so the "mcp-woocommerce can reach WordPress" probe failed although the path was open. The probe now sends `X-Forwarded-Proto: https`, as Traefik would, and still expects `200`. The same probe still passes on the local cluster.
3. `fix: rehearsal cluster maps http to host port 8081 (8080 was in use)`: see above.

Known leftovers from the rehearsal:

- A **fresh install restarted the gateway once or twice** while Postgres initialised. Root cause (found on the local fresh install of 2026-10-23): the Postgres image pull took 1m51s, longer than the gateway's 30 x 2 s database wait and the 60 x 2 s startup probe. Fixed in commit `027d43e` (90 x 2 s wait, 110 x 2 s startup probe); the next fresh install had 0 gateway restarts ([troubleshooting](troubleshooting.md#the-gateway-restarted-once-or-twice-on-a-first-install)). The rehearsal itself was not re-run with the fix.
- The self-signed certificates are not trusted by browsers, and `curl` needs `-k`.

### 1. Choose a server

You need one Linux server with a public IPv4 address, **2 CPU cores and 8 GB of memory or more** (this stack's memory limits add up to about 3.5 GiB; k3s, Traefik and cert-manager need more), 30 GB of disk, and ports 22, 80 and 443 reachable from the internet.

**Oracle Cloud "Always Free" (a free option; facts from Oracle's documentation, [Always Free Resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm), checked 2026-10-22):**

| Resource | Always Free allowance | What it means for us |
|---|---|---|
| Ampere A1 compute (arm64) | 1,500 OCPU-hours and 9,000 GB-hours per month, i.e. **2 OCPUs and 12 GB of memory** running all month | One VM of 2 OCPU / 12 GB fits this stack. The CPU is **arm64**, so the images must be built for `linux/arm64` (step 6). |
| AMD micro VM | 1 GB of memory each | Too small. |
| Block storage | 200 GB in total | Plenty: the values use 10 + 10 + 5 GiB of volumes. |
| Outbound traffic | 10 TB per month | Plenty. |

Things to know, none of which this project can control: Oracle asks for a credit card to verify the account; capacity for A1 machines is not guaranteed in every region ("out of capacity" errors are common); and **idle reclamation**: Oracle may reclaim an Always Free instance when, over 7 days, the 95th percentile of CPU, network and (for A1) memory use are all below 20 %. A quiet demo store can match that, so check the instance regularly or accept that it may be stopped.

**Other options (not verified; prices and limits change, check the provider):** any VPS with 2 vCPU / 8 GB or more from Hetzner, DigitalOcean, Vultr, Linode or similar (x86-64, so `linux/amd64` images are enough), or a home server with a public IP. The steps below are the same.

### 2. Install k3s

On the server (Ubuntu or Debian assumed). **Not executed.**

```bash
curl -sfL https://get.k3s.io | sh -          # installs k3s as a service; includes Traefik, local-path storage, ServiceLB
sudo k3s kubectl get nodes                    # expected: one node, Ready
mkdir -p ~/.kube && sudo cp /etc/rancher/k3s/k3s.yaml ~/.kube/config && sudo chown "$USER" ~/.kube/config
export KUBECONFIG=~/.kube/config              # then plain "kubectl" works
HELM_VERSION=v4.3.1; ARCH=$(dpkg --print-architecture)   # the Helm version this project uses; amd64 or arm64
curl -fsSLO https://get.helm.sh/helm-$HELM_VERSION-linux-$ARCH.tar.gz
curl -fsSL https://get.helm.sh/helm-$HELM_VERSION-linux-$ARCH.tar.gz.sha256sum | sha256sum -c -   # must print OK
tar -xzf helm-$HELM_VERSION-linux-$ARCH.tar.gz && sudo install linux-$ARCH/helm /usr/local/bin/helm
git clone <your fork of this repository> && cd MCP-Gateway-on-Kubernetes
```

Helm is pinned to the release tarball and its published SHA-256 instead of a script from Helm's `main` branch. The download and checksum lines were checked on 2026-10-23 for `linux-amd64` (Git Bash): `OK`, and the archive holds a `linux-amd64/helm` binary. The `arm64` URL and checksum file exist as well.

**Why:** k3s is a small, certified Kubernetes in one binary, so the server runs the same kind of cluster as k3d does locally. The firewall must allow 22, 80 and 443 (on Oracle that is both the subnet's security list and, on Ubuntu images, `iptables`/`ufw`). The NetworkPolicies of this chart are enforced by k3s's built-in controller (checked on the k3s v1.35 used locally, 2026-10-22).

### 3. DNS records

At your domain's DNS provider create two **A records** pointing at the server's public IPv4 address: for example `store.yourdomain.com` and `app.yourdomain.com`. Check with `nslookup store.yourdomain.com`. Let's Encrypt can only issue a certificate when both names resolve to the server **before** you install (step 8).

### 4. Traefik: keep the real client IP

```bash
sudo cp deploy/prod/traefik-config.yaml /var/lib/rancher/k3s/server/manifests/traefik-config.yaml
```

**Why:** k3s lets you customise its packaged Traefik with a `HelmChartConfig` placed in `/var/lib/rancher/k3s/server/manifests`. Ours sets the Traefik Service's `externalTrafficPolicy: Local`, which stops Kubernetes from replacing the visitor's IP with the node's. The gateway rate-limits failed `/mcp` logins per IP, so it needs the real one. **Do not set `node-external-ip`** in the k3s configuration when you do this (k3s networking documentation, checked 2026-10-22). Expected: Traefik restarts with the new setting within a minute. **Not executed.**

### 5. cert-manager and the certificate issuer

cert-manager asks Let's Encrypt for a certificate for each Ingress that names a ClusterIssuer, proves you own the host over plain HTTP (the "HTTP-01" challenge, answered through Traefik) and renews it automatically.

```bash
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.21.2/cert-manager.yaml
kubectl -n cert-manager rollout status deploy/cert-manager-webhook --timeout=180s
```

Edit `deploy/prod/cluster-issuer-letsencrypt.yaml` and replace `CHANGE-ME@example.com` with your real email, then:

```bash
kubectl apply -f deploy/prod/cluster-issuer-letsencrypt.yaml
kubectl get clusterissuer letsencrypt-prod      # expected: READY True
```

**Not executed** (it needs a real domain): a real Let's Encrypt issuance stays **expected; not tested** until a real domain is used. For the HTTP-01 challenge, cert-manager starts a temporary solver pod (`cm-acme-http-solver-*`, port 8089) in `store` and `gateway`. The chart's NetworkPolicy `acme-http01-solver` lets Traefik reach it there; without that policy the default-deny rules would block every challenge. The policy's effect was verified on the local cluster on 2026-10-23 with a stand-in solver pod ([ADR-016](decisions/ADR-016-default-deny-network-policies.md)). cert-manager v1.21.2's solver pod passes Pod Security `restricted` without changes (checked in its source). For a rehearsal without DNS, `deploy/prod/cluster-issuer-selfsigned.yaml` creates an issuer named `selfsigned`; set `global.tls.clusterIssuer: selfsigned` to use it. Browsers warn about its certificates. Let's Encrypt has rate limits, so while testing repeatedly use its staging server first.

### 6. Build and push multi-arch images (not executed)

> **Not executed:** this publishes images to *your* GitHub account, so it was not run for this project.

The chart pulls `<registry>/urumi/<app>:<tag>` for five apps: `mcp-woocommerce`, `mcp-notes`, `mcp-utilities`, `gateway` (all built from `docker/node-app.Dockerfile` with `--build-arg APP=<app>`) and `dashboard` (`docker/dashboard.Dockerfile`). An Oracle A1 server is arm64, so build for both architectures:

```bash
# a classic token with the write:packages scope: GitHub > Settings > Developer settings > Tokens (classic)
echo "$GHCR_TOKEN" | docker login ghcr.io -u <github-user> --password-stdin
docker buildx create --use                                    # once; a builder that can do multi-arch
TAG=$(git rev-parse --short HEAD)
for APP in mcp-woocommerce mcp-notes mcp-utilities gateway; do
  docker buildx build --platform linux/amd64,linux/arm64 -f docker/node-app.Dockerfile \
    --build-arg APP=$APP -t ghcr.io/<github-user>/urumi/$APP:$TAG --push .
done
docker buildx build --platform linux/amd64,linux/arm64 -f docker/dashboard.Dockerfile \
  -t ghcr.io/<github-user>/urumi/dashboard:$TAG --push .
```

**Use lower case.** Image references must be lower-case, so write your GitHub user name in lower case in every `-t ghcr.io/<github-user>/...` above and in `global.imageRegistry`. With `MyName`, the pods fail with `InvalidImageName`.

Then make each of the five packages **public** (GitHub > your profile > Packages > the package > Package settings > Change visibility), because **the chart has no imagePullSecrets**: a private package fails with `ImagePullBackOff`. (If you must keep them private, k3s can authenticate through `/etc/rancher/k3s/registries.yaml`; expected to work, not tested.) Building the arm64 half on an x86 PC uses emulation and is slow.

### 7. Create the Secrets

```bash
./scripts/prod/create-prod-secrets.sh you@yourdomain.com
```

**Why:** `deploy/values-prod.yaml` names pre-created Secrets, so passwords are generated on the server and never appear in a file, in Git or on a command line. The script creates the three namespaces **with the Helm ownership labels and annotations** (otherwise `helm install` refuses to adopt them), generates every Secret with `openssl rand` in the same shapes the chart uses, makes the copies shared by two namespaces byte-identical, and offers to store the optional AI keys (typed hidden; skipped when not in a terminal). The email becomes the gateway admin login. It never prints a value and is safe to repeat: an existing Secret is reported `kept` and not changed. It refuses to run on the local `k3d-urumi` context. It ends by printing the *commands* that read each password, for example:

```bash
kubectl -n store get secret store-admin -o jsonpath='{.data.password}' | base64 -d; echo
```

**Verified** on a throw-away k3d cluster from Git Bash on Windows (2026-10-23, see the table above). These Secrets are the only copy of the database passwords, so back them up.

### 8. Install the chart

Edit `deploy/values-prod.yaml`: replace every `CHANGE-ME` (registry user, image tag, the WordPress admin email) and both `example.com` hostnames. Then check and install:

```bash
helm lint charts/urumi-platform -f deploy/values-prod.yaml
helm upgrade --install urumi charts/urumi-platform --namespace urumi-system --create-namespace \
  -f deploy/values-prod.yaml --wait --timeout 15m
```

On a Windows machine whose kube context points at the server you can use `scripts\deploy.ps1 -ValuesFile deploy\values-prod.yaml`, which refuses to run on the local `k3d-urumi` context (and refuses the local values on any other context). `scripts\validate-chart.ps1` warns while placeholders remain. The first install downloads WooCommerce, so allow several minutes. **Not executed on a VPS.**

### 9. Verify the site

```bash
kubectl get pods -A                                  # expected: everything Running 1/1 (store-setup: Completed)
kubectl get certificate -A                           # expected: urumi-tls-store (store) and urumi-tls-app (gateway), READY True
kubectl get challenges -A                            # expected: none left once the certificates are READY
kubectl -n store get cronjob wp-cron                 # expected: LAST SCHEDULE within the last 5 minutes
kubectl -n store logs job/$(kubectl -n store get jobs -o name | grep wp-cron | tail -1 | cut -d/ -f2)
                                                     # expected: "Success: Executed a total of N cron events." (N may be 0)
curl -sI http://store.yourdomain.com | head -5       # expected: 301 Moved Permanently, Location: https://store.yourdomain.com/
curl -sI https://store.yourdomain.com | grep -i strict-transport-security
                                                     # expected: max-age=31536000 (no includeSubDomains)
```

Open `https://store.yourdomain.com` and `https://app.yourdomain.com`. The redirect and HSTS come from two Traefik `Middleware` objects per namespace (`redirect-https`, `hsts`) that the chart creates only when `global.tls.enabled` is true and that the two Ingresses reference by annotation. The HSTS header lasts one year and does not cover subdomains. If a certificate stays `READY False`, look at `kubectl describe certificate -A` and `kubectl get challenges -A`, and see [troubleshooting](troubleshooting.md#a-certificate-stays-ready-false). WordPress's scheduled work (WP-Cron, WooCommerce's Action Scheduler) runs from the `wp-cron` CronJob every 5 minutes, because WordPress's own request to its public URL is blocked by the NetworkPolicies on a VPS ([ADR-018](decisions/ADR-018-wordpress-cron-via-cronjob.md)); if its Jobs fail, see [troubleshooting](troubleshooting.md#scheduled-wordpress-work-does-not-run-wp-cron-cronjob). **Expected; not executed on a real domain.**

**WordPress behind TLS (verified 2026-10-23):** TLS ends at Traefik, so WordPress itself receives plain HTTP with an `X-Forwarded-Proto: https` header. The official `wordpress` image already handles this. In the running pod, `grep -n HTTP_X_FORWARDED_PROTO /var/www/html/wp-config.php` shows, at line 122:

```php
if (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && strpos($_SERVER['HTTP_X_FORWARDED_PROTO'], 'https') !== false) {
	$_SERVER['HTTPS'] = 'on';
}
```

so no extra configuration was added. Task 5.7 checks that the store's HTML over https contains no `http://` asset URLs.

### 10. Logs

```bash
kubectl -n gateway logs deploy/gateway --tail=100
kubectl -n store logs job/store-setup
kubectl -n store logs deploy/wordpress -c wordpress --tail=100
kubectl -n cert-manager logs deploy/cert-manager --tail=100     # certificate problems
kubectl -n kube-system logs deploy/traefik --tail=100
```

### 11. Upgrade and roll back

```bash
git pull
helm upgrade urumi charts/urumi-platform -n urumi-system -f deploy/values-prod.yaml --wait --timeout 15m
helm history urumi -n urumi-system
helm rollback urumi <revision> -n urumi-system --wait
```

An upgrade with a new image tag re-pulls the images (build and push them first, step 6). `helm rollback` re-applies an earlier revision's manifests; it does **not** undo database changes, so take a backup (next section) before a risky upgrade. The Secrets and data volumes are kept across upgrades and rollbacks. The upgrade command was exercised on the local cluster in earlier phases ([Step 7](#step-7-upgrade-change-settings-or-the-chart)); rollback commands are documented at [Step 8](#step-8-roll-back). On a VPS they are **expected** to behave the same.

### 12. Backups

The data lives in two databases. Dump them with `kubectl exec`; the password is read **inside** the container from its environment, so it never appears on your command line. Run these from your own computer or the server, then keep the files somewhere else (they contain customer and account data and are not encrypted).

```bash
# WordPress/WooCommerce (MariaDB): all databases, consistent snapshot
kubectl -n store exec mariadb-0 -c mariadb -- sh -c 'mariadb-dump -uroot -p"$MARIADB_ROOT_PASSWORD" --single-transaction --routines --all-databases' | gzip > store-$(date +%F).sql.gz

# Gateway (Postgres): users, keys (encrypted), servers, audit log, chats
kubectl -n gateway exec postgres-0 -c postgres -- sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -U gateway -h 127.0.0.1 gateway' | gzip > gateway-$(date +%F).sql.gz
```

**Verified on the local cluster, 2026-10-23** (redirected to a scratch folder without `gzip`; only sizes and table counts were checked, then the files were deleted): the MariaDB dump was 41,827 lines / 5.1 MB with 78 `CREATE TABLE` statements; the Postgres dump was 796 lines / 69 KB with 8 `CREATE TABLE` statements.

**Not tested: restoring.** The expected restore is the reverse, into an empty database; rehearse it before you depend on it:

```bash
gunzip -c store-DATE.sql.gz | kubectl -n store exec -i mariadb-0 -c mariadb -- sh -c 'mariadb -uroot -p"$MARIADB_ROOT_PASSWORD"'
gunzip -c gateway-DATE.sql.gz | kubectl -n gateway exec -i postgres-0 -c postgres -- sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -U gateway -h 127.0.0.1 gateway'
```

The `wp-content` volume (uploads, plugins) is **not** in the dump: copy it with `kubectl cp` or snapshot the VM's disk. Also keep a copy of the Secrets you created; the gateway's `encryption-key` decrypts the stored provider keys, and without it those keys are lost.

### 13. The Helm release Secret note

Helm stores each release's manifests and values in a Secret named `sh.helm.release.v1.urumi.vN` in `urumi-system`. Because every password here lives in a pre-created Secret and not in the values, **none of them is inside the release Secret** (a reason to prefer `create-prod-secrets.sh` over chart-generated Secrets in production). Anyone who can read Secrets in `urumi-system` still sees the rendered manifests and your values, so keep cluster-admin access to people you trust. Encrypting Secrets at rest (a k3s option) was not enabled or tested. Measured on the local release, which uses chart-generated Secrets: its stored manifest holds all of them ([security.md, residual risk 19](security.md#8-residual-risks)).
