# Deployment guide

> **Status (end of Phase 2).** The **local (k3d)** deployment of the store is complete and verified: install, upgrade, uninstall/reinstall and a truly fresh install were all run. Phase 2 added the **WooCommerce MCP server** to the chart (namespace `mcp`, internal only) and the image build step that `up.ps1` now runs before every deploy. The gateway and dashboard are not part of the chart yet **(planned, Phases 3-4)**. The **production (k3s VPS)** section is **(planned, Phase 5)**.

Cost: the local deployment uses no paid service and no cloud account; everything runs on your machine in Docker. (The reason production is a VPS and not Vercel/Render is in [ADR-012](decisions/ADR-012-deployment-target-k3s-vps.md).)

Related documents: how the pieces fit together [architecture.md](architecture.md); what each step does internally [workflows.md](workflows.md); when something goes wrong [troubleshooting.md](troubleshooting.md).

## Local (k3d)

### What you are building

A single-node Kubernetes cluster (k3s, running inside a Docker container via k3d) with one Helm release called `urumi` in the namespace `urumi-system`. The release creates the namespaces `store`, `mcp` and `gateway`; today `store` contains MariaDB, WordPress with WooCommerce, an Ingress for `store.localhost`, three generated Secrets, and a one-off Job that configures the shop, and `mcp` contains the WooCommerce MCP server (one Deployment, a ClusterIP Service, two Secrets, **no Ingress**). `gateway` is still empty.

### Prerequisites

| Tool | Version used | Why | Check |
|---|---|---|---|
| Windows 11 with PowerShell 5.1 | - | The scripts are PowerShell | `$PSVersionTable.PSVersion` |
| Docker Desktop (WSL2 backend), **running** | 4.85.0 | k3d runs the cluster as Docker containers | `docker version` |
| k3d | v5.9.0 | Creates the cluster | `k3d version` |
| kubectl | v1.36.1 | Talks to the cluster | `kubectl version --client` |
| Helm | v4.3.1 | Installs the chart | `helm version` |
| Node.js, then `npm ci` once from the repository root | 24 (used: 24.0.1) | Not needed to run the store or the MCP server (their images build inside Docker). Needed for the host-side checks (`check-mcp-woocommerce.ps1` imports the MCP SDK from the repository's `node_modules`, the optional REST API check) and for `npm test` | `node --version` |
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

### Step 3a. Build our program images (new in Phase 2)

The MCP server runs from an image that is built from this repository and loaded straight into the cluster (there is no registry locally). `up.ps1` does this automatically. If you deploy with `deploy.ps1` yourself, run this first, **before** step 3:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-images.ps1
```

**Why before:** `helm --wait` waits for every workload, including `mcp-woocommerce`, to be Ready, and Helm runs the store-setup Job only after that. If the image is missing, the MCP pod cannot start and the install waits until the timeout. **What it does:** `docker build` with `docker/node-app.Dockerfile`, `k3d image import` into cluster `urumi`, and a tag file `deploy/.images.local.yaml` (git-ignored) that `deploy.ps1` passes to Helm. The tag is the git short SHA, with `-dirty-<timestamp>` appended when the working tree has any change (even an untracked file); details in the [run guide](run-guide.md#build-the-program-images-build-imagesps1). Without the tag file the chart uses the tag `dev` and the pod cannot start ([troubleshooting](troubleshooting.md#mcp-woocommerce-is-in-errimageneverpull-or-imagepullbackoff)).

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

**Kept on purpose** (so a mistaken uninstall cannot destroy the store): the namespaces `store`, `mcp`, `gateway`; the PVCs `wordpress-data` and `data-mariadb-0`; the Secrets `store-db`, `store-admin`, `store-woo-api`. **Removed:** the WordPress Deployment, MariaDB StatefulSet, Services, Ingress and ConfigMap. The finished `store-setup` Job and its Pod may remain; they are harmless and are replaced on the next deploy.

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

By default the chart generates the Secrets. To supply your own, they must exist in namespace `store` before the install, but the chart also **owns** the namespace `store` (and `mcp`, `gateway`). A plain `kubectl create namespace store` would therefore make the first install fail with "exists and cannot be imported". Create the namespace **with Helm's ownership metadata** so that Helm adopts it **(expected; verified in Phase 5, not exercised yet)**:

```powershell
kubectl create namespace store
kubectl label namespace store app.kubernetes.io/managed-by=Helm
kubectl annotate namespace store meta.helm.sh/release-name=urumi meta.helm.sh/release-namespace=urumi-system
# now create the Secrets in that namespace, e.g.:
kubectl -n store create secret generic store-admin --from-literal=password=<your-password>
```

(Do the same for `mcp`: the `storeWooApi` and `mcpWoocommerceToken` Secrets also live there, see the `storeWooApi` and `mcpWoocommerceToken` rows in the table below.) Then name the Secrets in the values file under `secrets.existing`:

| Values key | Secret keys required | Notes |
|---|---|---|
| `storeDb` | `root-password`, `password` | MariaDB root and application passwords. They must match the data already on the volume. |
| `storeAdmin` | `password` | WordPress admin password. The key must be named exactly `password`. |
| `storeWooApi` | `consumer-key`, `consumer-secret` | The consumer secret must be at most **43 characters** (WooCommerce stores it in a `char(43)` column). The chart's own generated secret is `cs_` plus 40 characters = 43. **The same Secret must also exist in namespace `mcp`** (the MCP server reads it there; with `storeWooApi` set the chart renders no copy). |
| `mcpWoocommerceToken` | `token` | The bearer token of the MCP server, in namespace `mcp` (at least 16 characters; the generated one is 48). Phase 3 will need a copy in namespace `gateway`. |

`deploy/values-prod.yaml` already names these Secrets and points to this procedure. It also has two placeholders for our own images, `global.imageRegistry` and `global.imageTag` (both `CHANGE-ME`): production pulls `<registry>/urumi/mcp-woocommerce:<tag>` from a real registry instead of importing it. Pushing images to a registry is **(planned, Phase 5)**; the local import workflow is the only one exercised.

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
| MCP server status and logs | `kubectl -n mcp get pods,svc` and `kubectl -n mcp logs deploy/mcp-woocommerce` |
| Release state | `helm status urumi -n urumi-system`, `helm history urumi -n urumi-system` |
| What values are in use? | `helm get values urumi -n urumi-system` |

### Local limitations

- Single node, single replica for every component; no backups and no high availability.
- The `local-path` storage lives inside the k3d node container: it survives pod restarts and `helm uninstall` (both verified), and survives `k3d cluster stop` (verified 2026-10-18), but not `cluster-down.ps1`.
- No TLS locally (plain HTTP), and no mail server, so WooCommerce e-mails are not delivered.
- The cluster needs internet access for image pulls and for downloading WooCommerce 11.2.1 during setup.

## Production (k3s VPS) — (planned, Phase 5)

Not built yet. The planned approach is one k3s node on a VPS with the same chart and `deploy/values-prod.yaml` (currently a stub with placeholder hostnames, TLS settings and pre-created Secret names); see [ADR-012](decisions/ADR-012-deployment-target-k3s-vps.md) for why a VPS is used instead of Vercel/Render.
