# Troubleshooting

> **Status (end of Phase 5).** Covers the local k3d cluster, the store, the MCP servers, the gateway and its Postgres database, the dashboard and the AI chat (the entries from [Chat says the AI provider isn't configured](#chat-says-the-ai-provider-isnt-configured) onwards), and the Phase 5 layers: NetworkPolicies, Pod Security, the loopback-only cluster, production certificates and the `wp-cron` CronJob (from [A pod cannot reach X after Phase 5](#a-pod-cannot-reach-x-after-phase-5) onwards).

Each entry has a **symptom**, a **diagnosis** command and a **fix**. Entries marked **(observed)** happened while building Phase 1; the others are standard Kubernetes/Helm/WooCommerce behavior that follows from the chart's settings and was not deliberately triggered. Commands run from the repository root in PowerShell; refresh `PATH` first if a tool is "not found". Deployment steps: [deployment.md](deployment.md); how the flows work: [workflows.md](workflows.md).

Quick triage, in this order:

```powershell
kubectl config current-context                     # should be k3d-urumi
kubectl -n store get pods                          # all Running, setup Pod Completed
kubectl -n store get events --sort-by=.lastTimestamp
kubectl -n store logs job/store-setup
helm status urumi -n urumi-system
```

## Contents

- [`up.ps1` says Docker is not running](#upps1-says-docker-is-not-running)
- [`up.ps1` warns that `store.localhost` is not in the hosts file](#upps1-warns-that-storelocalhost-is-not-in-the-hosts-file)
- ["running scripts is disabled on this system"](#running-scripts-is-disabled-on-this-system)
- [`up.ps1` says "previous install did not complete"](#upps1-says-previous-install-did-not-complete)
- [Another operation is in progress (pending-install)](#another-operation-is-in-progress-pending-install)
- [Docker Desktop's Kubernetes tab shows no cluster](#docker-desktops-kubernetes-tab-shows-no-cluster)
- [I cannot see my guest order in My Account](#i-cannot-see-my-guest-order-in-my-account)
- [`customer-order-smoke.ps1` fails](#customer-order-smokeps1-fails)
- [Port 80 is already in use](#port-80-is-already-in-use)
- [`helm` or `k3d` not found](#helm-or-k3d-not-found)
- [Refusing to deploy local values to context](#refusing-to-deploy-local-values-to-context)
- [Helm namespace adoption failures](#helm-namespace-adoption-failures)
- [PVC stays Pending](#pvc-stays-pending)
- [MariaDB `CrashLoopBackOff` or WordPress cannot reach the database](#mariadb-crashloopbackoff-or-wordpress-cannot-reach-the-database)
- [WordPress shows 0/1 and its startup probe fails](#wordpress-shows-01-and-its-startup-probe-fails)
- [Probe warnings during first start](#probe-warnings-during-first-start)
- [WordPress restarts while the database is down](#wordpress-restarts-while-the-database-is-down)
- [The `store-setup` Job failed](#the-store-setup-job-failed)
- [The leftover store-setup Job](#the-leftover-store-setup-job)
- [Helm `--wait` times out](#helm---wait-times-out)
- [Storefront shows "coming soon"](#storefront-shows-coming-soon)
- [Checkout says no payment or shipping methods are available](#checkout-says-no-payment-or-shipping-methods-are-available)
- [`/checkout/` redirects to `/cart/`](#checkout-redirects-to-cart)
- [`check-woo-api.ps1` returns 401](#check-woo-apips1-returns-401)
- [`store.localhost` does not resolve in Node tools](#storelocalhost-does-not-resolve-in-node-tools)
- [Changing `mariadb.storage` fails on upgrade](#changing-mariadbstorage-fails-on-upgrade)
- [Running the known-answer tests](#running-the-known-answer-tests)
- [Pre-created Secrets with the wrong keys](#pre-created-secrets-with-the-wrong-keys)
- [`mcp-woocommerce` is in ErrImageNeverPull or ImagePullBackOff](#mcp-woocommerce-is-in-errimageneverpull-or-imagepullbackoff)
- [`mcp-woocommerce` CrashLoopBackOff with an environment variable message](#mcp-woocommerce-crashloopbackoff-with-an-environment-variable-message)
- [The external store answers 401 or 403, or the MCP server cannot reach it](#the-external-store-answers-401-or-403-or-the-mcp-server-cannot-reach-it)
- [The MCP server answers 401 Unauthorized](#the-mcp-server-answers-401-unauthorized)
- [The MCP server answers 403 Invalid Host](#the-mcp-server-answers-403-invalid-host)
- [An MCP tool returns WooCommerce 401 Invalid signature](#an-mcp-tool-returns-woocommerce-401-invalid-signature)
- [An MCP tool times out](#an-mcp-tool-times-out)
- [The port-forward port (13001) is already in use](#the-port-forward-port-13001-is-already-in-use)
- [The store-setup Job fails with `missing urumi_managed_key_owner marker`](#the-store-setup-job-fails-with-missing-urumi_managed_key_owner-marker)
- [Inspector prints a libuv assertion at the end (Windows)](#inspector-prints-a-libuv-assertion-at-the-end-windows)
- [Inspector says `Invalid header format: Bearer`](#inspector-says-invalid-header-format-bearer)
- [`create_product` says `regular_price must be non-negative with at most 2 decimals`](#create_product-says-regular_price-must-be-non-negative-with-at-most-2-decimals)
- [The MCP check says `Dependencies not installed` or `Cannot find package '@modelcontextprotocol/client'`](#the-mcp-check-says-dependencies-not-installed-or-cannot-find-package-modelcontextprotocolclient)
- [The gateway pod is in CrashLoopBackOff: `database not ready after 90 attempts`](#the-gateway-pod-is-in-crashloopbackoff-database-not-ready-after-90-attempts)
- [The gateway pod is in CrashLoopBackOff with an `Invalid environment` message](#the-gateway-pod-is-in-crashloopbackoff-with-an-invalid-environment-message)
- [`/mcp` answers 401 on the gateway](#mcp-answers-401-on-the-gateway)
- [`/api` answers 403 `CSRF_REJECTED`](#api-answers-403-csrf_rejected)
- [Login answers 429 (too many attempts)](#login-answers-429-too-many-attempts)
- [A server shows `unreachable` in the gateway](#a-server-shows-unreachable-in-the-gateway)
- [An in-cluster MCP server is refused or unreachable](#an-in-cluster-mcp-server-is-refused-or-unreachable)
- [`app.localhost` does not resolve in Node tools](#applocalhost-does-not-resolve-in-node-tools)
- [Postgres does not start: `PGDATA` permission errors](#postgres-does-not-start-pgdata-permission-errors)
- [Gateway, Notes or Utilities pod in `ErrImagePull`](#gateway-notes-or-utilities-pod-in-errimagepull)
- [Upgrade fails: `spec.strategy.rollingUpdate: Forbidden`](#upgrade-fails-specstrategyrollingupdate-forbidden)
- [PowerShell gotchas with kubectl](#powershell-gotchas-with-kubectl)
- [Chat says the AI provider isn't configured](#chat-says-the-ai-provider-isnt-configured)
- [Chat says the AI provider rejected the API key (`LLM_AUTH_FAILED`)](#chat-says-the-ai-provider-rejected-the-api-key-llm_auth_failed)
- [Chat says the AI provider is rate limited (429)](#chat-says-the-ai-provider-is-rate-limited-429)
- [Chat says the AI provider is unavailable, or the answer was unexpected](#chat-says-the-ai-provider-is-unavailable-or-the-answer-was-unexpected)
- [The dashboard is blank, or a refresh gives 404](#the-dashboard-is-blank-or-a-refresh-gives-404)
- [`check-dashboard.ps1` says Playwright Chromium is not installed](#check-dashboardps1-says-playwright-chromium-is-not-installed)
- [The Vite dev server gives 403 `CSRF_REJECTED`](#the-vite-dev-server-gives-403-csrf_rejected)
- [The dashboard pod is in `ErrImagePull` (image tag not found)](#the-dashboard-pod-is-in-errimagepull-image-tag-not-found)
- [`npm ci` prints `EBADENGINE` warnings for jsdom](#npm-ci-prints-ebadengine-warnings-for-jsdom)
- [A pod cannot reach X after Phase 5](#a-pod-cannot-reach-x-after-phase-5)
- [`forbidden: violates PodSecurity`](#forbidden-violates-podsecurity)
- [Another computer or phone can no longer open the local store](#another-computer-or-phone-can-no-longer-open-the-local-store)
- [`smoke-test.ps1` fails at one step](#smoke-testps1-fails-at-one-step)
- [After recreating the cluster, old passwords and API keys stop working](#after-recreating-the-cluster-old-passwords-and-api-keys-stop-working)
- [The gateway restarted once or twice on a first install](#the-gateway-restarted-once-or-twice-on-a-first-install)
- [A certificate stays `READY False`](#a-certificate-stays-ready-false)
- [Scheduled WordPress work does not run (`wp-cron` CronJob)](#scheduled-wordpress-work-does-not-run-wp-cron-cronjob)

---

## `up.ps1` says Docker is not running

**Symptom.** `ERROR: Docker is not running. Start Docker Desktop, wait for "Engine running", then run this again.`

**Diagnosis.** `docker info` fails or hangs.

**Fix.** Start Docker Desktop and wait until it shows "Engine running" (this can take a minute after a reboot), then run `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\up.ps1` again. The cluster lives in Docker containers, so nothing works without it. If Docker Desktop will not start, run `wsl --shutdown` and start it again **(expected)**.

## `up.ps1` warns that `store.localhost` is not in the hosts file

**Symptom.** `WARNING: store.localhost is not in the hosts file. Run: ... scripts\setup-hosts.ps1`. It is a warning, not an error; `up.ps1` continues.

**Fix.** Browsers and `curl` resolve `*.localhost` by themselves, so you can ignore it if you only use a browser. Node-based MCP tools need the entry: run `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\setup-hosts.ps1` and accept the UAC prompt (safe to repeat). Background: [deployment.md, step 2](deployment.md#step-2-make-localhost-names-resolve-for-every-tool).

## "running scripts is disabled on this system"

**Symptom.** Typing `scripts\up.ps1` (or any `scripts\x.ps1`) gives `... cannot be loaded because running scripts is disabled on this system`.

**Cause.** Windows 11's default PowerShell execution policy blocks script files typed directly (expected; standard Windows behavior).

**Fix.** Run the script through a child PowerShell with the policy bypassed for that one process, from the repository root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\up.ps1
```

Do not change the machine-wide policy; this form does not need to. Where the docs write `scripts\x.ps1 [args]` for short, use this form.

## `up.ps1` says "previous install did not complete"

**Symptom.** A yellow notice `previous install did not complete (status: failed) - running deploy` (or `(namespace "store" is missing)`), followed by the deploy output.

**Cause.** `helm status` succeeds for every release state, so `up.ps1` reads the release status and the `store` namespace. A `failed` release or a missing namespace is repaired by the deploy (`helm upgrade --install` fixes failed releases and recreates namespaces). The decision logic was tested in isolation; a real failed release was not produced (expected behavior).

**Fix.** Nothing to do if the deploy then succeeds. If it fails again, read the cause: `helm status urumi -n urumi-system`, `kubectl -n store logs job/store-setup`, and the entries below.

## Another operation is in progress (pending-install)

**Symptom.** `up.ps1` stops with `a previous helm operation on release urumi was interrupted (status: pending-install)` (or `pending-upgrade` / `pending-rollback`), or Helm itself says `another operation (install/upgrade/rollback) is in progress`.

**Cause.** A previous `helm install` or `helm upgrade` was killed (closed terminal, Ctrl+C, reboot) and left the release locked in a `pending-*` state. `up.ps1` deliberately does not fix this automatically (expected behavior; not reproduced on the live release).

**Fix.** Check with `helm status urumi --namespace urumi-system`, then:

- `pending-install`: `helm uninstall urumi --namespace urumi-system` (your data is kept because of the `keep` policy), then run `up.ps1` again.
- `pending-upgrade` or `pending-rollback`: `helm rollback urumi --namespace urumi-system`, then run `up.ps1` again.

## Docker Desktop's Kubernetes tab shows no cluster

**Symptom.** Docker Desktop's "Kubernetes" tab says there is no cluster, and only three containers (`k3d-urumi-*`) are listed, although the store works.

**Explanation (verified 2026-10-18).** That tab manages only Docker Desktop's own built-in Kubernetes. This project uses k3d ([ADR-002](decisions/ADR-002-k3d-k3s-traefik.md)). The pods run inside the `k3d-urumi-server-0` container, so Docker Desktop does not list them. This is normal; do not enable Docker Desktop's Kubernetes. See the pods with `kubectl get pods -A` ([run guide, section 1](run-guide.md#1-what-runs-where)).

## I cannot see my guest order in My Account

**Symptom.** You placed an order without logging in, then registered with the same email; My Account → Orders does not list it.

**Explanation (verified 2026-10-18).** WooCommerce 11.2.1 does not attach earlier guest orders to a later account with the same email (guest order 19 stayed customer id 0). The order exists: the admin sees it in WooCommerce → Orders.

**Fix.** Nothing is lost. For future orders, log in (or register) before checkout. See [workflows.md](workflows.md#5-customer-account-and-order-history).

## `customer-order-smoke.ps1` fails

**Symptom.** `SMOKE FAILED: ...`. The message names the step:

| Message | Likely cause | Fix |
|---|---|---|
| `no woocommerce-register-nonce ...` or `registration form has no password field` | Registration options not applied | `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\up.ps1 -Redeploy`, then retry. |
| `registration did not log the customer in` | Registration was rejected, or the store is not ready | Try `/my-account/` in a browser; check `kubectl -n store get pods`. |
| `Store API returned no products`, `cart/add-item failed` or `checkout failed` | No products, a product out of stock, or the store not ready | Check the shop page and stock in wp-admin; `kubectl -n store logs deploy/wordpress -c wordpress`. |
| `Store API cart response has no Nonce header` | The Store API did not return a nonce (store not ready, or a WooCommerce version that changed the header) | Check `kubectl -n store get pods` and open `/wp-json/wc/store/v1/cart` in a browser; retry once the store is ready. |
| `checkout response has no order_id` | Checkout returned a response without an order (for example a validation problem) | Place an order in the browser to see the visible error; check `kubectl -n store logs deploy/wordpress -c wordpress`. |
| `order #N is not listed at .../my-account/orders/` | The order was not tied to the customer (the check looks for the order link `view-order/N/`) | Re-run once; if it persists, check the order's customer in WooCommerce → Orders. |
| Connection errors | Cluster stopped or Docker not running | `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\up.ps1` |

Pass `-BaseUrl` if your store URL differs (for example port 8081). Likely causes are **(expected)**; they were not each triggered.

## Port 80 is already in use

**Symptom.** `scripts\cluster-up.ps1` stops with `ERROR: k3d cluster create failed (is host port 80 or 443 already in use?)`.

**Diagnosis.**

```powershell
Get-NetTCPConnection -LocalPort 80 -State Listen | Select-Object LocalAddress, OwningProcess
Get-Process -Id <OwningProcess>
```

**Fix.** Stop the program using port 80 (often IIS, another web server, or a VPN/agent), then re-run `cluster-up.ps1`. If you cannot free it, use the port-8081 procedure in [deployment.md step 10](deployment.md#step-10-if-host-port-80-is-taken-use-8081) (not tested end to end). Port 8080 is deliberately not the fallback on the reference machine because it is already used there ([setup log](learning/00-setup-log.md#port-8080-conflict)).

## `helm` or `k3d` not found

**Symptom.** `ERROR: 'helm' was not found on PATH. Install it ... or open a NEW terminal so PATH refreshes.` (from `cluster-up.ps1` / `deploy.ps1`), or PowerShell says the term is not recognized.

**Diagnosis.** `Get-Command helm, k3d, kubectl`.

**Fix.** The tools were installed with `winget`, which updates `PATH` for **new** terminals only. Open a new terminal, or refresh the current one:

```powershell
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
```

If it is still missing, install it (see [learning/00-setup-log.md](learning/00-setup-log.md)).

## Refusing to deploy local values to context

**Symptom.** `ERROR: Refusing to deploy local values to context '<name>'. Run: kubectl config use-context k3d-urumi`.

**Diagnosis.** `kubectl config current-context` and `kubectl config get-contexts`.

**Fix.** `kubectl config use-context k3d-urumi` (or run `scripts\cluster-up.ps1`, which selects it). This guard exists so that `values-local.yaml` can never be applied to another cluster by accident.

## Helm namespace adoption failures

**Symptom.** The first install fails with an error like `Namespace "store" in namespace "" exists and cannot be imported into the current release: invalid ownership metadata ...` **(expected Helm behavior, not forced in Phase 1)**.

**Cause.** The chart owns the namespaces `store`, `mcp` and `gateway`. Helm only adopts an existing object that carries its ownership metadata (`meta.helm.sh/release-name` and `meta.helm.sh/release-namespace` annotations and the `app.kubernetes.io/managed-by: Helm` label). A namespace you created by hand with `kubectl create ns store` has none.

**Diagnosis.** `kubectl get ns store -o yaml` (look at `metadata.annotations` and `labels`).

**Fix.** If the namespace is empty and you created it yourself: `kubectl delete ns store` (destroys anything in it) and run `deploy.ps1` again. Never create the three namespaces by hand **without the Helm ownership metadata**. When you really need the namespace before the install (to pre-create Secrets for production), add the label `app.kubernetes.io/managed-by=Helm` and the annotations `meta.helm.sh/release-name=urumi` and `meta.helm.sh/release-namespace=urumi-system`, as shown in [deployment.md](deployment.md#pre-created-secrets-advanced-mostly-for-production) (expected to be adopted; verified in Phase 5).

**Reinstall after uninstall works, with a condition.** After `helm uninstall urumi -n urumi-system`, the kept namespaces, PVCs and Secrets still carry the annotations `meta.helm.sh/release-name: urumi` and `release-namespace: urumi-system`. A reinstall is therefore adopted cleanly (verified on the reference machine, 2026-10-18) **only with the same release name and namespace** (`urumi` / `urumi-system`). Installing under a different name or namespace hits the ownership error above. To start over under another name, delete the kept objects first (`helm uninstall urumi -n urumi-system`, then `kubectl delete ns store mcp gateway`, **destroys data**).

## PVC stays Pending

**Symptom.** `kubectl -n store get pvc` shows `Pending`.

**Diagnosis.** `kubectl -n store describe pvc <name>`.

**Fix.** Often nothing: the k3s `local-path` StorageClass uses `WaitForFirstConsumer`, so a claim stays `Pending` until a Pod that uses it is scheduled **(observed: the event is `waiting for first consumer to be created before binding`, followed by `ProvisioningSucceeded` a couple of seconds later)**. If it stays Pending for more than a minute: check that the Pod using it is not itself stuck (`kubectl -n store describe pod ...`), and that the provisioner runs: `kubectl -n kube-system get pods -l app=local-path-provisioner`. If you set `global.storageClass` to a class that does not exist, clear it (empty means the cluster default).

## MariaDB `CrashLoopBackOff` or WordPress cannot reach the database

**Symptom.** `mariadb-0` restarts repeatedly; or MariaDB is `Running` but WordPress answers with "Error establishing a database connection" / probe status 500 that does not go away; or the setup Job logs `database not reachable within 300s`.

**Diagnosis.**

```powershell
kubectl -n store logs mariadb-0
kubectl -n store logs mariadb-0 --previous
kubectl -n store describe pod mariadb-0
# Does the application password in the Secret match the one inside the database?
kubectl -n store exec mariadb-0 -- sh -c 'mariadb -uwordpress -p\"$MARIADB_PASSWORD\" -e \"select 1 as ok\"'
```

`ERROR 1045 ... Access denied` means the password injected from Secret `store-db` is not the one the data directory was initialised with.

**Causes and fixes.**

1. **Secret and data volume out of sync (leftover data with a different password).** The MariaDB image applies `MARIADB_ROOT_PASSWORD`/`MARIADB_PASSWORD` **only when it initialises an empty data directory**. If the volume `data-mariadb-0` survived but the Secret `store-db` was deleted and regenerated, MariaDB starts normally but with passwords nobody knows. This is why the chart annotates the generated Secrets with `helm.sh/resource-policy: keep` and why `helm uninstall` keeps both Secrets and PVCs. Fix: restore the original Secret if you still have it; otherwise accept the loss and delete both together (`helm uninstall urumi -n urumi-system`, then `kubectl delete ns store`, which destroys the store), then run `deploy.ps1`. Never delete only one of the two.
2. **Volume permissions.** MariaDB runs as uid/gid 999 with `fsGroup: 999`; a volume left by a different image/user can be unreadable. `logs` shows `Permission denied`. Fix: delete the PVC (data loss) and let it be recreated.
3. **Out of memory.** `describe pod` shows `OOMKilled`; the limit is 512 Mi. Free memory (the WSL2 cap) or raise `mariadb.resources.limits.memory` in the values.
4. **Starting slowly.** MariaDB's startup probe allows 60 x 5 s = 5 minutes. A probe error such as `Can't connect to local server through socket '/run/mysqld/mysqld.sock'` in the first seconds is normal **(observed)**.

## WordPress shows 0/1 and its startup probe fails

**Symptom.** `kubectl -n store get pods` shows `wordpress-...` as `0/1 Running` (or `Init:...`) for longer than a minute or two.

**Diagnosis.**

```powershell
kubectl -n store describe pod -l app.kubernetes.io/name=wordpress    # events and probe results
kubectl -n store logs deploy/wordpress -c copy-wordpress              # the initContainer
kubectl -n store logs deploy/wordpress -c wordpress
```

**Causes and fixes.**

- **HTTP 500 from the probe** (`Startup probe failed: HTTP probe failed with statuscode: 500`): WordPress cannot reach MariaDB yet. Normal for the first seconds **(observed)**; if persistent, see the MariaDB entry above. The startup probe allows 30 x 10 s = 5 minutes.
- **initContainer `copy-wordpress` failing:** it copies the WordPress files onto the volume as uid 33 (the image's own non-root copy fails because the volume root belongs to root; see [architecture.md](architecture.md#store-design-points)). Its log should say `copying WordPress files` then `copied`, or `WordPress files present` on later starts. A permission error means the volume was created with different ownership: delete the PVC `wordpress-data` (data loss) and redeploy.
- **Not scheduled / image pull:** `describe pod` shows `ErrImagePull`/`ImagePullBackOff`: no internet, or Docker Desktop is not running.

## Probe warnings during first start

**Symptom.** `kubectl -n store get events` shows `Warning ProbeWarning ... Probe terminated redirects` for WordPress, and `Startup probe failed: HTTP probe failed with statuscode: 500` **(observed on every fresh install)**.

**Explanation.** Before WordPress is installed, `GET /wp-login.php` answers **HTTP 302** (redirect to the installer). The kubelet counts a 3xx as success but emits a warning that it did not follow the redirect. These warnings are expected until the setup Job installs WordPress and are harmless. The 500 comes from WordPress starting before MariaDB is ready and disappears by itself.

## WordPress restarts while the database is down

**Symptom.** WordPress's `RESTARTS` counter goes up after a MariaDB outage (for example after `kubectl delete pod mariadb-0` or a node problem).

**Explanation (known trade-off).** The WordPress liveness probe requests `/wp-login.php`, which needs the database. If the database is unavailable for longer than about 2 minutes (6 failures x 20 s), the kubelet restarts the WordPress container. The restart is harmless (no data is in the web Pod) and WordPress recovers by itself once MariaDB is back. A restart count of 0 on a healthy install is what you should see (verified on the fresh install).

## The `store-setup` Job failed

**Symptom.** `deploy.ps1` prints `ERROR: helm upgrade --install failed. Diagnose with: ...`, or `kubectl -n store get pods` shows `store-setup-xxxxx` in `Error`, or several such Pods.

**Diagnosis.**

```powershell
kubectl -n store get pods -l job-name=store-setup
kubectl -n store logs job/store-setup
kubectl -n store describe job store-setup
kubectl -n store describe pod -l job-name=store-setup
```

A healthy fresh install shows exactly one Pod, `Completed`, and `kubectl -n store get job store-setup -o jsonpath='{.status.failed}'` prints nothing (or 0). Every failed attempt is a separate Pod (`backoffLimit: 3` means up to four in total); read the log of the one that failed with `kubectl -n store logs <pod>`.

**Common causes and fixes.**

- **`ERROR: ADMIN_PASSWORD is empty`:** the `store-admin` Secret has no `password` value (for example a pre-created Secret with an empty key). Set a non-empty `password` in the Secret (never print its value), then re-run the deploy.
- **`database not reachable within ...s; last error: ...`:** the message carries the last 5 lines WP-CLI printed, for example a MariaDB connection error. It never contains a password. Fix MariaDB or the connection first.
- **`WooCommerce X is newer than Y; not downgrading`** in the log is informational: `woocommerceVersion` is older than what is installed, and the Job leaves the plugin alone.
- **The Register form is missing on My Account:** `storeSetup.customerRegistration` is `false` (the production default). Set it to `true` and redeploy if you want it.
- **WooCommerce download fails** (`downloads.wordpress.org` unreachable): the Job needs internet to fetch `woocommerce.11.2.1.zip`. Check your connection, DNS, VPN or proxy, then run `scripts\deploy.ps1` again; the Job restarts from scratch and is safe to repeat.
- **Out of memory** (`OOMKilled` in `describe pod`; limit 768 Mi): free memory or raise `storeSetup.resources.limits.memory`.
- **`database not reachable within 300s` / `wp-config.php did not appear within 300s`:** WordPress or MariaDB is not healthy; fix that first (entries above), then re-run `deploy.ps1`.
- **`DeadlineExceeded`** in `describe job`: the Job took more than `activeDeadlineSeconds: 480`; usually a slow download. Re-run `deploy.ps1`.
- **A WooCommerce option error** such as `woocommerce_task_list_hidden` failing: that old option is gone in WooCommerce 11.2.1 and the chart uses `woocommerce_task_list_hidden_lists` instead **(observed during Phase 1 development)**. If you change `woocommerceVersion`, re-check the options in `charts/urumi-platform/files/store-setup/setup.sh`.
- **`sendmail: can't connect to remote host (127.0.0.1)`** in the log is harmless noise **(observed)**: there is no mail server, so WooCommerce cannot send the admin e-mail it tries to send when settings change.

After fixing the cause, re-run the deploy; `helm upgrade --install` replaces the failed release state **(expected)**.

## The leftover store-setup Job

**Symptom.** After `helm uninstall`, `kubectl -n store get job,pods` still lists `store-setup` and a `Completed` Pod.

**Explanation.** A hook Job is not part of the release's tracked manifest, so uninstall does not delete it **(observed)**. It is harmless: the Job has `helm.sh/hook-delete-policy: before-hook-creation`, so the next install/upgrade deletes it right before creating the new one, and meanwhile its log stays readable. You may delete it by hand: `kubectl -n store delete job store-setup`.

## Helm `--wait` times out

**Symptom.** After 10 minutes: `Error: ... context deadline exceeded` / `timed out waiting for the condition`, followed by the `deploy.ps1` ERROR line.

**Diagnosis.** Something never became Ready (or the setup Job never finished). Find out which:

```powershell
kubectl -n store get pods -o wide
kubectl -n store get events --sort-by=.lastTimestamp
kubectl -n store describe pod <the one that is not Ready>
kubectl -n store logs job/store-setup
```

**Fix.** Follow the entry that matches the symptom (image pull, MariaDB, WordPress, Job). The Job's `activeDeadlineSeconds` is 480 s, shorter than the 10-minute Helm timeout, so a stuck Job fails earlier with its own reason. When fixed, run `scripts\deploy.ps1` again; do not uninstall first (that would not remove the data anyway).

## Storefront shows "coming soon"

**Symptom.** `http://store.localhost` shows a "coming soon" page instead of the shop.

**Diagnosis / fix.** New WooCommerce stores start in coming-soon mode; the setup Job sets `woocommerce_coming_soon` to `no`. Check the setup log for the `woocommerce_coming_soon` line (`Success: Updated ...` or `... is unchanged`: `kubectl -n store logs job/store-setup`), and in wp-admin under WooCommerce → Settings → Site visibility. If the Job did not complete, fix that (entry above) and re-run `deploy.ps1`. (Admins logged in at `/wp-admin` can always preview the shop even in coming-soon mode, so check while logged out.)

## Checkout says no payment or shipping methods are available

**Symptom.** At checkout WooCommerce says there are no payment methods (or shipping options).

**Cause and fix.** The setup Job configures Cash on delivery (`woocommerce_cod_settings` enabled) and disables shipping (`woocommerce_ship_to_countries=disabled`). If the Job did not run to the end, or settings were changed in wp-admin, those can be missing. Check WooCommerce → Settings → Payments (Cash on delivery enabled) and Shipping. Re-running `scripts\deploy.ps1` re-applies every option; it is idempotent. If you re-enabled shipping in wp-admin, the next deploy turns it off again by design.

## `/checkout/` redirects to `/cart/`

**Symptom.** Opening `http://store.localhost/checkout/` (or `curl`) answers HTTP 302 to `/cart/`.

**Explanation.** Correct WooCommerce behavior: the checkout page redirects to the cart when the cart is empty. Add a product to the cart first. Verified: `curl.exe -s -o NUL -w "%{http_code} -> %{redirect_url}" http://store.localhost/checkout/` prints `302 -> http://store.localhost/cart/`. It is not a bug and not a failed deployment.

## `check-woo-api.ps1` returns 401

**Symptom.** `scripts\check-woo-api.ps1` ends with `ERROR: Signed request with the public store URL did not return 200`, or the first line shows HTTP 401.

**Background.** The third line printing 401 is expected (it signs the wrong URL on purpose). Only a 401 on the **first** line is a problem. WooCommerce verifies the OAuth1 signature against the **public store URL** rebuilt from its own configuration, not the URL the request was sent to ([ADR-005](decisions/ADR-005-woocommerce-rest-oauth1.md), [workflows.md](workflows.md#3-woocommerce-rest-access-oauth1)).

**Causes and fixes.**

1. **Wrong signing base.** It must be the public store URL (`WP_HOME`) with its scheme replaced by `http`. The port is included only if `WP_HOME` has one, i.e. if you changed `global.publicPort` to a non-default value (e.g. 8081, giving `http://store.localhost:8081`); with https on 443 there is no port. `check-woo-api.ps1` omits the port, so for a non-default port run `node scripts/dev/woo-oauth-check.mjs --target http://127.0.0.1:<pf-port> --sign-base http://store.localhost:8081` yourself with the key in `WOO_CONSUMER_KEY`/`WOO_CONSUMER_SECRET`. Also the scheme is always `http` for in-cluster requests, even if the public URL is `https`, because they never use TLS and carry no `X-Forwarded-Proto`.
2. **Clock skew.** WooCommerce rejects OAuth timestamps more than 15 minutes (plus or minus) away from its own time. After the laptop sleeps, the WSL2/Docker clock can drift. Compare `[DateTime]::UtcNow` with `kubectl -n store exec deploy/wordpress -c wordpress -- date -u`. Fix: restart Docker Desktop or run `wsl --shutdown`.
3. **Nonce reuse.** WooCommerce stores nonces per consumer key; a replayed request is rejected. The script generates a fresh nonce per request; custom clients must too and must not retry with the same nonce.
4. **Key out of sync.** The API key row is written by the setup Job from Secret `store-woo-api`. If the Secret changed but the Job did not run, re-run `scripts\deploy.ps1`.
5. **Port-forward not ready.** The script waits 3 s; on a slow machine re-run it.

## `store.localhost` does not resolve in Node tools

**Symptom.** A Node-based tool (an MCP client, `fetch` in a script) fails with `ENOTFOUND store.localhost` while a browser or `curl` works.

**Cause.** Browsers and `curl` resolve every `*.localhost` name to `127.0.0.1` by themselves; Node uses the operating system resolver, which on this machine does not ([setup log](learning/00-setup-log.md#hosts-file-scriptssetup-hostsps1)).

**Fix.** Run `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\setup-hosts.ps1` and accept the UAC prompt. It adds `127.0.0.1 store.localhost app.localhost hello.localhost` to the Windows hosts file. If elevation fails, the script prints the exact line to add by hand to `C:\Windows\System32\drivers\etc\hosts`.

## Changing `mariadb.storage` fails on upgrade

**Symptom.** After editing `mariadb.storage` (default `2Gi`) and running `deploy.ps1`, Helm fails with `StatefulSet.apps "mariadb" is invalid: spec: Forbidden: updates to statefulset spec for fields other than 'replicas', 'ordinals', 'template', 'updateStrategy', 'persistentVolumeClaimRetentionPolicy' and 'minReadySeconds' are forbidden` **(expected Kubernetes behavior, not forced in Phase 1)**.

**Cause.** The MariaDB disk is declared through `volumeClaimTemplates`, which Kubernetes treats as immutable. Also, the `local-path` provisioner cannot expand an existing volume.

**Fix (safest): set the size before the first install.** To change it later on a local cluster, back up and recreate:

```powershell
# 1. Back up the database to a file on your machine (cmd.exe keeps the SQL as plain text; PowerShell 5.1 would re-encode it)
cmd /c "kubectl -n store exec mariadb-0 -- sh -c ""mariadb-dump -uroot -p`$MARIADB_ROOT_PASSWORD wordpress"" > wordpress-backup.sql"
# 2. Recreate with the new size (destroys the store: data, uploads, passwords)
helm uninstall urumi -n urumi-system
kubectl delete ns store mcp gateway --wait=true --timeout=300s
# 3. Edit mariadb.storage, then deploy a fresh store
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\deploy.ps1
```

The backup command was verified (it produced a valid MariaDB dump); **restoring is not scripted** and uploads on the `wordpress-data` volume are not part of this dump, so treat this as a development convenience, not a migration procedure. An alternative is `kubectl -n store delete statefulset mariadb --cascade=orphan` followed by `deploy.ps1`, which lets Helm recreate the StatefulSet object while keeping the Pod and volume, but the existing PVC keeps its old size, so it only changes what is written in the template **(not tried)**.

## Running the known-answer tests

**Symptom.** `node --test scripts/dev/` fails (for example "Cannot find module").

**Fix.** On Node 24.0.1 the directory form is not accepted; give a glob (quoted, so PowerShell does not expand it):

```powershell
node --test "scripts/dev/*.test.mjs"
```

Expected: `tests 5`, `pass 5`, `fail 0`. They compare the OAuth1 signer with values produced independently by PHP. Do not run the root `npm test`/`npm run build` in Phase 1: the npm workspaces do not exist until Phase 2 and those scripts exit with "No workspaces found".

## Pre-created Secrets with the wrong keys

**Symptom.** With `secrets.existing.*` set, a Pod stays in `CreateContainerConfigError` ("couldn't find key ...") or the setup Job fails to start.

**Fix.** Create the Secrets in namespace `store` with exactly these keys: `storeDb`: `root-password` and `password`; `storeAdmin`: `password`; `storeWooApi`: `consumer-key` and `consumer-secret`, with the consumer secret at most **43 characters** (WooCommerce stores it in a `char(43)` column; a longer value cannot be inserted by the setup Job). With `storeWooApi` the same Secret (same name, same two keys) must also exist in namespace `mcp`, and `mcpWoocommerceToken` needs one key, `token`, in namespace `mcp`. Diagnose with `kubectl -n store describe pod <name>` and `kubectl -n store describe secret <name>` (shows key names and sizes only, not values).

## `mcp-woocommerce` is in ErrImageNeverPull or ImagePullBackOff

**Symptom.** `kubectl -n mcp get pods` shows the `mcp-woocommerce` pod in `ErrImageNeverPull` or `ImagePullBackOff` (or `ErrImagePull`). `kubectl -n mcp describe pod -l app.kubernetes.io/name=mcp-woocommerce` names an image such as `urumi/mcp-woocommerce:dev`.

**Cause.** The cluster has no registry; our images are built on your laptop and copied in with `k3d image import`. The pod asks for an image tag the cluster does not hold. The usual reason is that the chart was deployed without the tag file `deploy/.images.local.yaml`, so it fell back to the default tag `dev`, which was never built. `deploy.ps1` printed a yellow `no local image tag; run scripts\build-images.ps1` line when that happened. The chart's pull policy is `IfNotPresent`: the node first looks for the image locally and, when it is missing, tries to pull `urumi/mcp-woocommerce` from Docker Hub, where it does not exist, so you normally see `ErrImagePull` and then `ImagePullBackOff`. `ErrImageNeverPull` appears instead if the pull policy is `Never` (for example if you set `global.imagePullPolicy: Never`). **Expected**: neither state has occurred on the reference machine, because `up.ps1` always builds first.

**Fix.**

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-images.ps1      # builds, imports, writes deploy\.images.local.yaml
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\up.ps1 -Redeploy      # rolls the pod onto the new tag
kubectl -n mcp get pods
```

`up.ps1` does both steps by itself whenever it deploys, so this normally only happens after running `deploy.ps1` by hand on a fresh clone, or after recreating the cluster (`cluster-down.ps1` deletes the imported images; run `up.ps1 -Redeploy` afterwards).

**Related: the pod restarts on every redeploy.** If `git status --porcelain` shows any change, even one new untracked file, the image tag is `<sha>-dirty-<timestamp>` and changes on every build, so each `-Redeploy` replaces the pod. A clean tree keeps the tag and the pod is left alone (verified 2026-10-18). Harmless; commit or remove stray files if it bothers you. Explanation: [run guide, build-images](run-guide.md#build-the-program-images-build-imagesps1).

**Related: `docker build` fails.** Make sure Docker Desktop is running (`docker version`). The build needs internet the first time (base image `node:24-alpine`, npm packages).

## `mcp-woocommerce` CrashLoopBackOff with an environment variable message

**Symptom.** `kubectl -n mcp get pods` shows `CrashLoopBackOff`, and `kubectl -n mcp logs deploy/mcp-woocommerce` (add `--previous` if the container restarted) prints one line like:

```text
Invalid environment: WOO_BASE_URL (required), MCP_AUTH_TOKEN (too small)
```

The server checks its configuration before it starts and exits if anything is missing or invalid. The message lists variable **names and the kind of problem only**, never values. (This message format is from the code and its tests; the live pod has never crashed this way, so the log text on your machine is **expected**, not observed.)

**Fix.** Find the variable in the table in [apps/mcp-woocommerce/README.md](../apps/mcp-woocommerce/README.md#configuration-environment-variables). In the cluster the values come from the chart, so look at what the pod really received (this prints non-secret values only; secrets show as references):

```powershell
kubectl -n mcp get deploy mcp-woocommerce -o yaml | Select-String -Pattern 'name: WOO_|name: MCP_|name: STORE_' -Context 0,2
kubectl -n mcp describe pod -l app.kubernetes.io/name=mcp-woocommerce       # a Secret problem shows as CreateContainerConfigError, not a crash
```

Common causes: `STORE_TIMEZONE` is not an IANA name such as `Asia/Kolkata` (the message says so); `WOO_SIGNING_BASE_URL` does not start with `http://` (the server insists, see the OAuth1 notes); a pre-created Secret has the wrong keys (see [Pre-created Secrets with the wrong keys](#pre-created-secrets-with-the-wrong-keys)). After fixing the values, run `up.ps1 -Redeploy`.

## The MCP server answers 401 Unauthorized

**Symptom.** A call to `http://127.0.0.1:13001/mcp` (through the port-forward) returns HTTP 401 with `{"jsonrpc":"2.0","error":{"code":-32001,"message":"Unauthorized"},"id":null}` (**observed**, 2026-10-19). `check-mcp-woocommerce.ps1` or Inspector reports an authentication failure.

**Cause.** The `Authorization: Bearer <token>` header is missing, malformed, or holds the wrong token. The server cannot tell you which, on purpose.

**Fix.** Copy the current token again and make sure the header is exactly `Authorization: Bearer ` followed by the token with no spaces or line breaks around it:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\get-secret.ps1 -Namespace mcp -Name mcp-woocommerce-token -Key token
```

The token is generated once and kept across upgrades; it only changes if you delete the Secret or `kubectl delete ns mcp`. If you use a pre-created Secret (`secrets.existing.mcpWoocommerceToken`) and rotated it, restart the pod so it reads the new value: `kubectl -n mcp rollout restart deploy/mcp-woocommerce` (see [deployment.md](deployment.md#known-limitation-rotating-a-pre-created-woocommerce-key-secret)).

## The MCP server answers 403 Invalid Host

**Symptom.** HTTP 403 with `{"jsonrpc":"2.0","error":{"code":-32000,"message":"Invalid Host: <name>"},"id":null}` (**observed** with a made-up host, 2026-10-19).

**Cause.** The `Host` header of the request is not in `MCP_ALLOWED_HOSTS`. The check compares **hostnames only**, so listing a port makes no difference (verified in the cluster: a request with the Service name plus port passed, a foreign host got 403). By default the chart allows `mcp-woocommerce`, `mcp-woocommerce.mcp`, `mcp-woocommerce.mcp.svc`, `mcp-woocommerce.mcp.svc.cluster.local`, `127.0.0.1` and `localhost`. This is a defence against DNS-rebinding attacks; probes (`/healthz`, `/readyz`) are never checked.

**Fix.** Use `http://127.0.0.1:13001/mcp` or `http://localhost:13001/mcp` through the port-forward, or call the Service by one of the names above from inside the cluster. A custom hostname (for example behind another proxy) must be added to the chart's host list in `charts/urumi-platform/templates/mcp/mcp-woocommerce.yaml`.

## An MCP tool returns WooCommerce 401 Invalid signature

**Symptom.** The MCP call itself succeeds (HTTP 200) but the result has `isError: true` and text like `WooCommerce returned 401: Invalid signature - provided signature does not match.` **(expected from ADR-005; the live server has only produced valid signatures so far)**. `scripts\check-mcp-woocommerce.ps1` fails on its first call.

**Background.** WooCommerce checks the OAuth1 signature against the public store URL it rebuilds from its own configuration. See [ADR-005](decisions/ADR-005-woocommerce-rest-oauth1.md) and [workflow 3](workflows.md#3-woocommerce-rest-access-oauth1).

**Causes and fixes, most likely first.**

1. **Wrong signing base.** `WOO_SIGNING_BASE_URL` must be the public store URL with scheme `http` (`http://store.localhost` locally; with `global.publicPort=8081` it is `http://store.localhost:8081`). Check what the pod uses:
   ```powershell
   kubectl -n mcp get deploy mcp-woocommerce -o yaml | Select-String -Pattern 'WOO_SIGNING_BASE_URL' -Context 0,1
   ```
   The value comes from the chart helper `urumi.storeSigningBaseUrl`; fix `global.storeHost` / `global.publicPort` in your values and run `up.ps1 -Redeploy`.
2. **Clock skew over 15 minutes** between the MCP pod and the store (both run in the same Docker VM, so this usually means the whole VM clock drifted after the laptop slept). Compare `[DateTime]::UtcNow` with `kubectl -n mcp exec deploy/mcp-woocommerce -- date -u`. Restart Docker Desktop or run `wsl --shutdown`.
3. **Key out of sync.** The MCP pod holds the key from the `mcp` copy of `store-woo-api`; the store holds the hash of the `store` copy. They are rendered from the same value. If you pre-created either Secret yourself, make sure both match, then `kubectl -n mcp rollout restart deploy/mcp-woocommerce`. To test the key outside MCP run `scripts\check-woo-api.ps1`.
4. **Pretty permalinks switched off** (REST path no longer `/wp-json/...`). The setup Job turns them on; re-run `up.ps1 -Redeploy`.

The server never prints the key, the secret or a signed URL in logs or results, so these checks look at configuration, not at the failing request.

## An MCP tool times out

**Symptom.** The tool result is `isError: true` with `WooCommerce request failed (timeout): WooCommerce did not respond within 10000ms` **(unit-tested; not triggered live)**. Or your client reports its own timeout first.

**Cause.** WooCommerce (WordPress plus PHP plus MariaDB) did not answer within `WOO_TIMEOUT_MS` (default 10 000 ms), for example while the store pod is starting, under memory pressure, or while the setup Job is busy.

**Fix.**

```powershell
kubectl -n store get pods                      # wordpress and mariadb-0 should be 1/1 Running
kubectl -n store logs deploy/wordpress -c wordpress --tail=50
```

Wait until the store is ready and call again. The server does **not** retry (a retry could duplicate a created product, see [workflow 6](workflows.md#6-mcp-tool-call-to-the-store)); after a timeout on `create_product`, list the products first to see whether it was created. To allow slower answers raise `mcpWoocommerce.timeoutMs` in your values (allowed 1000 to 60000) and run `up.ps1 -Redeploy`.

## The port-forward port (13001) is already in use

**Symptom.** `kubectl port-forward` prints `unable to listen on port 13001` / `bind: Only one usage of each socket address`, or `check-mcp-woocommerce.ps1` says the port-forward exited or did not open port 13001.

**Cause.** Another process holds local port 13001, often a previous `kubectl port-forward` that is still running (for example a forgotten window or a hidden one left by an interrupted script).

**Fix.** Find and stop it, or use another local port:

```powershell
Get-NetTCPConnection -LocalPort 13001 -State Listen | Select-Object OwningProcess
Get-Process -Id <OwningProcess>          # make sure it is kubectl, then:  Stop-Process -Id <OwningProcess>
kubectl -n mcp port-forward svc/mcp-woocommerce 23001:3001      # or pick another free local port; use it in the URL too
```

`check-mcp-woocommerce.ps1` always uses 13001 and stops its own port-forward when it ends, so close your manual one first.

## The store-setup Job fails with `missing urumi_managed_key_owner marker`

**Symptom.** `deploy.ps1` / `up.ps1` fails, `kubectl -n store get pods -l job-name=store-setup` shows `Error` pods, and `kubectl -n store logs job/store-setup` ends with:

```text
[store-setup] ERROR: user 'urumi-mcp' exists but was not created by store setup (missing urumi_managed_key_owner marker); refusing to grant shop_manager. ...
```

**Cause.** The WooCommerce API key used by the MCP server is owned by a dedicated user, `urumi-mcp` (Shop manager). Store setup creates that user and marks it with the user meta `urumi_managed_key_owner=1`. On a later run it only reuses a user that carries the marker. A `urumi-mcp` account **without** the marker is not trusted: with open customer registration and WooCommerce generating logins from e-mail addresses, anyone could register `urumi-mcp@example.com` and obtain that login, and the Job would otherwise hand the key to them. (Task 2.5 proved the refusal by running the Job's PHP check against a throwaway unmarked shop manager; the live shell path was only syntax-checked.)

**Fix, case 1: you do not recognise the account (probably an imposter).** Look at it, then delete or rename it in wp-admin (**Users -> All Users**), or from the terminal:

```powershell
"SELECT ID, user_login, user_email, user_registered FROM wp_users WHERE user_login LIKE 'urumi-mcp%';" | kubectl -n store exec -i mariadb-0 -- sh -c 'exec mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" wordpress'
```

Delete it in wp-admin (it is the safest way, because WordPress cleans up its other tables), then run `up.ps1 -Redeploy`; the Job creates a fresh, marked `urumi-mcp`.

**Fix, case 2: the account is legitimately yours** (for example you created `urumi-mcp` by hand, or the store was installed from the intermediate Phase 2 commit **before this marker existed**; see the upgrade note below). Add the marker. The `wordpress` image has no WP-CLI, so use a small PHP script through `kubectl exec` (this is the method used in Task 2.5; the snippet below is adapted from it and was **not re-run exactly as written**):

```powershell
@'
<?php
require '/var/www/html/wp-load.php';
$u = get_user_by('login', 'urumi-mcp');
if (!$u) { echo "user not found\n"; exit(1); }
update_user_meta($u->ID, 'urumi_managed_key_owner', '1');
echo 'marker=' . get_user_meta($u->ID, 'urumi_managed_key_owner', true) . "\n";
'@ | kubectl -n store exec -i deploy/wordpress -c wordpress -- sh -c 'cat > /tmp/m.php && php /tmp/m.php; rm -f /tmp/m.php'
```

It should print `marker=1`. Then run `up.ps1 -Redeploy`. Check that you really own the account first (role, e-mail) before adding the marker; the marker is what tells setup to trust it.

**Upgrade note: who needs the marker.** A store upgraded from **Phase 1** (`main`) never had a `urumi-mcp` user: its API key was owned by `admin`. On upgrade the Job creates and marks `urumi-mcp` and moves the key to it, so there is nothing to do (from reading the Job's code; the reviewer confirmed this path). A fresh install needs nothing either. Only a store installed from the **intermediate Phase 2 commit** that created `urumi-mcp` before the marker existed (Task 2.5, before its security fix) has an unmarked user; there the Job refuses until you add the marker with the case 2 script. In practice that was only the reference cluster, which was migrated this way during Task 2.5 (`marker=1`, then a clean redeploy).

## Inspector prints a libuv assertion at the end (Windows)

**Symptom.** After an `npx -y @modelcontextprotocol/inspector@2.11.0 --cli ...` command prints its JSON, Windows shows an `Assertion failed` message mentioning libuv (and sometimes a non-zero exit code).

**Cause and fix.** A cosmetic teardown problem of Node on Windows inside the Inspector, **not** a server fault (**observed** in Task 2.4 after an `isError` call). The printed result is valid; ignore the message. Nothing to fix.

## Inspector says `Invalid header format: Bearer`

**Symptom.** An Inspector CLI command with `--header "Authorization: Bearer $env:MCP_TOKEN"` prints `{"error":{"code":"error","message":"Invalid header format: Bearer. Use \"HeaderName: Value\" format."}}` (**observed** 2026-10-19).

**Cause.** `$env:MCP_TOKEN` does not hold the token. Most often it was set with `$env:MCP_TOKEN = Get-Clipboard` after `get-secret.ps1`, but copying that command (or the next one) from the guide replaced the token in the clipboard, so the variable holds command text with spaces and quotes, which splits the header apart.

**Fix.** Load the token straight from the Secret and check it (prints `True, length 48`, never the token), then run the Inspector command again on one line:

```powershell
$env:MCP_TOKEN = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String((kubectl -n mcp get secret mcp-woocommerce-token -o 'jsonpath={.data.token}')))
"token loaded: $([bool]$env:MCP_TOKEN), length $($env:MCP_TOKEN.Length)"
```

See [run-guide section 8, Step 3a](run-guide.md#explore-it-with-mcp-inspector).

## `create_product` says `regular_price must be non-negative with at most 2 decimals`

**Symptom.** `create_product` returns an `isError` result: `Input validation error ... regular_price: regular_price must be non-negative with at most 2 decimals, like "12", "12.50" or 12.5`.

**Cause.** The price had more than 2 decimals (`12.555`), was negative, or was not a number at all (`"abc"`). The server refuses such values instead of rounding them, so a price is never silently changed. A JSON number is fine: the Inspector CLI turns `--tool-arg regular_price=12.50` into the number 12.5, and the server stores it as `"12.50"` (**verified** 2026-10-19 from Git Bash; until the Phase 2 final fixes, numbers were refused with `expected string, received number`, and quoting the value was needed).

**Fix.** Send a price such as `12`, `12.5`, `"12.50"` or `12.50`.

## The MCP check says `Dependencies not installed` or `Cannot find package '@modelcontextprotocol/client'`

**Symptom.** `scripts\check-mcp-woocommerce.ps1` stops at once with `ERROR: Dependencies not installed: run npm ci from the repository root (needs Node 24), then run this again.` (**verified** 2026-10-19 by hiding the package). Running `node scripts/dev/mcp-smoke.mjs` by hand on a fresh clone instead fails with `ERR_MODULE_NOT_FOUND` / `Cannot find package '@modelcontextprotocol/client'` (**expected**; this is Node's standard message for a missing package).

**Cause.** The check runs a small MCP client on your PC, and it imports the MCP SDK from the repository's `node_modules` folder. `up.ps1` installs packages only inside the Docker image build, never on your PC, so a fresh clone has no `node_modules`.

**Fix.** Install Node 24 if `node -v` does not print `v24.` something ([run guide, section 2](run-guide.md#2-prerequisites-and-one-time-setup)), then once, from the repository root:

```powershell
npm ci
```

Run the check again.

## The gateway pod is in CrashLoopBackOff: `database not ready after 90 attempts`

**Symptom.** `kubectl -n gateway get pods` shows `gateway-...` in `CrashLoopBackOff` (or restarting), and `kubectl -n gateway logs deploy/gateway --previous` shows 90 warnings `database not ready` (one every 2 s, each with `attempt`, `attempts` and a `reason` code), followed by `gateway startup failed` with `"step":"database"`. The gateway deliberately exits after about 180 s (long enough for a cold pull of the Postgres image on a first install, which took about 2 minutes on 2026-10-23), so Kubernetes restarts it; it never serves `/mcp` on an unmigrated database. (The exit message itself is `database not ready after 90 attempts`; the log line carries only the error class, so the numbered warnings are what you see.)

**Diagnose.**

```powershell
kubectl -n gateway get pods                       # is postgres-0 1/1 Running?
kubectl -n gateway logs postgres-0 --tail=30      # "database system is ready to accept connections"?
kubectl -n gateway logs deploy/gateway --previous | Select-String "database not ready" | Select-Object -First 3
```

The `reason` is a driver code, never a password or host: `ECONNREFUSED` (Postgres is not listening yet or is down), `ENOTFOUND` (the Service name does not resolve: `postgres.gateway.svc.cluster.local`), `28P01` (password authentication failed), `3D000` (database does not exist).

**Fix.**

- On a **first install** this is normal for a minute: Postgres is still initialising. The gateway keeps retrying and the pod settles by itself (**expected**; not observed on the reference machine, where Postgres was ready first).
- `postgres-0` not Running: see [Postgres does not start](#postgres-does-not-start-pgdata-permission-errors).
- `28P01`: the password in `gateway-secrets` (key `postgres-password`) differs from the one the data directory was created with. This happens if the Secret was regenerated while the volume was kept. Restore the original Secret, or (**destroys the gateway's data**) delete the StatefulSet's PVC `data-postgres-0` and let Postgres initialise again (**expected**, not run).

## The gateway pod is in CrashLoopBackOff with an `Invalid environment` message

**Symptom.** `kubectl -n gateway logs deploy/gateway --previous` prints one line such as `Invalid environment: GATEWAY_ENCRYPTION_KEY (custom), PUBLIC_APP_URL (required)` and the container exits at once. Only the **variable names** and a short reason code in brackets (`required` for a missing variable, otherwise a word such as `custom`, `invalid format` or `too small`) are printed, never values.

**Cause and fix by name** (the full list is in [apps/gateway/README.md](../apps/gateway/README.md#configuration-environment-variables)):

| Name in the message | Meaning |
|---|---|
| `GATEWAY_ENCRYPTION_KEY` | Not base64 of exactly 32 bytes. The chart generates it with `randBytes 32`; this appears if a pre-created Secret has a plain string. |
| `GATEWAY_INTERNAL_TOKEN_SECRET` | Shorter than 32 characters. |
| `PUBLIC_APP_URL` | Missing or not a URL. |
| `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` | Missing, not an email, or the password is not 10-200 characters. |
| `SEED_SERVERS.<n>.<field>` | The JSON from the ConfigMap `gateway-config` is invalid; the number is the entry, the field is the problem. |
| `PGHOST`, `PGDATABASE`, `PGUSER`, `PGPASSWORD` | Missing; they come from the chart and the `gateway-secrets` Secret. |
| `UPSTREAM_CALL_TIMEOUT_MS` and the other `_MS` values | Outside the allowed range (the call timeout must be at least 11000), or `UPSTREAM_HEALTH_TIMEOUT_MS` is not below `UPSTREAM_HEALTH_INTERVAL_MS`. |
| `SSRF_ALLOWED_INTERNAL_HOSTS.<n>` | Entry `n` is not `*.` plus at least two labels, nor a name with a dot (for example `*.local` or `localhost`). |

`kubectl -n gateway describe pod -l app.kubernetes.io/name=gateway` and `kubectl -n gateway get secret` show whether a Secret key is missing (a missing key is `CreateContainerConfigError`, not a crash loop). Fix the Secret or the Helm value, then `scripts\up.ps1 -Redeploy`. Statement is **tested** (`test/config.test.ts`); a crash loop from this cause was not reproduced on the cluster.

## `/mcp` answers 401 on the gateway

**Symptom.** An MCP client or `curl.exe` gets `401` with `{"jsonrpc":"2.0","error":{"code":-32001,"message":"Unauthorized"},"id":null}` and the header `WWW-Authenticate: Bearer`. The answer is the same for every reason on purpose.

**Causes, most likely first.**

1. **The key is revoked, or its user is disabled.** Check:

   ```powershell
   "SELECT id, event, outcome, error_message, started_at FROM audit_logs WHERE event = 'auth_rejected' ORDER BY id DESC LIMIT 5;" | kubectl -n gateway exec -i postgres-0 -- psql -U gateway gateway
   ```

   The `error_message` says `API key revoked`, `user disabled`, `unknown credential` (a well-formed key that is not stored) or `internal token expired` (**live** before the final-review fix: `API key revoked`, and the older text `unknown or malformed credential`). A malformed value or another scheme writes **no** row (see causes 2 and 4). Create a new key ([run guide](run-guide.md#log-in-and-create-an-api-key-powershell-51)).
2. **The key was pasted wrongly**: a truncated or changed key, extra quotes, or the clipboard held something else. A key is exactly `ugw_` plus 43 letters and digits (47 characters). A changed character gives `unknown credential`; a wrong length writes no audit row at all.
3. **No `Authorization` header** (a client that does not send headers, or a typo in its configuration). Nothing is written to the audit log in this case, only a log line `mcp auth rejected` with reason `missing`.
4. **The header is not `Authorization: Bearer <key>`** (`Basic`, a missing space, a different header name): rejected like an unknown credential, but not audited (only a debug log line), so it does not show in `audit_logs`.
5. **An old key after the gateway database was reset.** The users and keys are gone with it.

**Not the cause:** the API key does not expire by itself. A revoked key gets 401 on its very next request (**live**).

## `/api` answers 403 `CSRF_REJECTED`

**Symptom.** A `POST`, `PUT`, `PATCH` or `DELETE` to `http://app.localhost/api/...` from PowerShell, `curl.exe` or a script answers `403` with `{"error":{"code":"CSRF_REJECTED","message":"Request rejected by CSRF protection",...}}`, even when you are logged in. GET requests work (**live**).

**Cause.** Every mutating `/api` request needs **both** `Content-Type: application/json` **and** `Origin: http://app.localhost` (the origin of `PUBLIC_APP_URL`). That includes `DELETE` with no body. PowerShell's `Invoke-RestMethod` sends neither by default. The check runs before the login check, so you see it even without a session.

**Fix (PowerShell 5.1).**

```powershell
$h = @{ Origin = 'http://app.localhost' }
Invoke-RestMethod -Method Delete -Uri "$base/api/keys/$id" -WebSession $s -Headers $h -ContentType 'application/json'
```

With `curl.exe`: add `-H "Origin: http://app.localhost" -H "Content-Type: application/json"`. If you reach the gateway under another address (a different port, `127.0.0.1`, a port-forward), the `Origin` must equal the configured `PUBLIC_APP_URL` exactly, so use `http://app.localhost` there too (you can still connect to `127.0.0.1:<port>`; only the header matters).

## Login answers 429 (too many attempts)

**Symptom.** `POST /api/auth/login` answers `429` with `{"error":{"code":"RATE_LIMITED","message":"Too many login attempts; try again later","details":{"retryAfterSec":60}}}` and the header `Retry-After: 60`.

**Cause.** More than 10 login attempts in one minute for the same email from the same client address. Every attempt counts, right or wrong. The 11th was refused (**live**). The limit is per email and address, so another email is not affected.

**Fix.** Wait `Retry-After` seconds (60 at most). The counter is in memory, so restarting the gateway pod also clears it (**expected**, not run). Behind Traefik the address comes from `X-Forwarded-For` because the chart sets `TRUST_PROXY=1`; if everyone seems to share one counter, check that variable (`kubectl -n gateway get deploy gateway -o yaml` and look for `TRUST_PROXY`).

## A server shows `unreachable` in the gateway

**Symptom.** `GET /api/servers` (or SQL query 3 in the [run guide](run-guide.md#useful-read-only-queries)) shows `status: unreachable` and a `lastError`, and the server's tools are missing from `tools/list`.

```powershell
$servers = Invoke-RestMethod -Uri "$base/api/servers" -WebSession $s
$servers | Select-Object slug, status, lastError, checkedAt | Format-Table -AutoSize
```

| `lastError` | Cause | Fix |
|---|---|---|
| `connection refused` | The upstream pod is down, restarting or listens elsewhere; or, for your own in-cluster server, the NetworkPolicy blocks the gateway (seen 2026-10-23: `connection refused`, not a timeout) | `kubectl -n mcp get pods`; wait for the next check (15 s) or `POST /api/servers/<id>/refresh`; for your own server see [the section below](#an-in-cluster-mcp-server-is-refused-or-unreachable) |
| `DNS lookup failed` | The URL's name does not resolve | Correct the URL (`http://<service>.mcp.svc.cluster.local:<port>/mcp`) and `kubectl -n mcp get svc` |
| `timeout after 5000ms` | The upstream is up but too slow to list tools | `kubectl -n mcp logs deploy/<name>`; check the pod's CPU |
| `HTTP 401 from upstream` | The stored credential is wrong or was rotated | `PATCH /api/servers/<id>` with a new `credential`; for the seeded servers compare with `scripts\get-secret.ps1 -Namespace mcp -Name <secret> -Key token` (`key` for utilities) |
| `HTTP 404 from upstream` | The URL path is wrong (it must end in `/mcp`) | Correct the URL |
| `HTTP 302 from upstream (redirects are not followed)` | The URL redirects; the gateway never follows redirects | Use the final URL |
| `blocked by SSRF guard (private)` | The name resolves to a private address and is not on `SSRF_ALLOWED_INTERNAL_HOSTS` | Use a `*.mcp.svc.cluster.local` name, or for another namespace list it in the chart value `gateway.internalUpstreams` ([how](#an-in-cluster-mcp-server-is-refused-or-unreachable)) |
| `blocked by SSRF guard (loopback)` / `(link_local)` | The URL points at the pod itself or a metadata address | Use the real Service name; loopback is never allowed on the cluster |
| `error: ...` | Something else, for example a reset | `kubectl -n gateway logs deploy/gateway` shows the `upstream status` line |

The seeded servers are created once from the Helm values. Changing the Helm seed later does **not** change an existing row; edit it through the API. Full list of texts: [error-handling.md](error-handling.md#1-mcp-the-aggregated-endpoint). `lastError` strings are **tested**; `connection refused` and the disappearing tools were also **live** (scaling `mcp-utilities` to 0).

## An in-cluster MCP server is refused or unreachable

**Symptom.** Adding your own server whose URL ends in `.svc.cluster.local` gives the inline error `Upstream URL rejected: ...` followed by `If this server runs inside this cluster, list its namespace in the chart setting gateway.internalUpstreams.` (API: `400 SSRF_REJECTED`), or the server is saved but stays `unreachable` with `connection refused`.

**Cause.** The gateway only trusts `*.mcp.svc.cluster.local` and may only open connections to the three built-in servers; every other in-cluster destination needs an entry in the chart value `gateway.internalUpstreams` (namespace, port, optional pod labels). If the URL is not a cluster name but a public host name that resolves to a private (LAN) address, the guard refuses it on purpose and `internalUpstreams` cannot help: use the server's in-cluster Service name, or a public address.

**Fix.**

1. Add the entry (see [deployment.md](deployment.md#registering-mcp-servers-that-run-inside-the-cluster)) and run `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\up.ps1 -Redeploy`.
2. Check what the gateway received: `kubectl -n gateway get deploy gateway -o json` and look for `SSRF_ALLOWED_INTERNAL_HOSTS` in the container env (it must list `*.<your namespace>.svc.cluster.local`), and `kubectl -n gateway get networkpolicy gateway -o yaml` for the egress rule to your namespace and port.
3. For the `mcp` namespace also check `kubectl -n mcp get networkpolicy` for `mcp-internal-upstream-<n>`, and that `podLabels` match your pod (`kubectl -n mcp get pods --show-labels`).
4. For any other namespace the chart does not create the ingress side: admit the gateway pods in that namespace's own policy.
5. The URL must use the Service name and the port listed in the entry, and must end in the path your server serves (usually `/mcp`).
6. Right after a new pod starts, policies can take a few seconds to apply: refresh again after ten seconds.

## `app.localhost` does not resolve in Node tools

**Symptom.** `check-gateway.ps1` stops with `app.localhost does not resolve`, or a Node script fails with `ENOTFOUND app.localhost`, while a browser and `curl.exe` work.

**Cause and fix.** The same as for `store.localhost` ([above](#storelocalhost-does-not-resolve-in-node-tools)): Node uses the operating system resolver. Run `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\setup-hosts.ps1` once (UAC prompt); it adds `app.localhost` along with the other names. As a workaround without the hosts entry: `kubectl -n gateway port-forward svc/gateway 13000:3000`, then `check-gateway.ps1 -Base http://127.0.0.1:13000` (the `-Base` option exists; this port-forward workaround was **not tested**). `/api` calls that need CSRF still want `Origin: http://app.localhost`.

## Postgres does not start: `PGDATA` permission errors

**Symptom.** `postgres-0` is in `CrashLoopBackOff` or `Error`, and `kubectl -n gateway logs postgres-0` contains `initdb: error: directory "/var/lib/postgresql/data" exists but is not empty` mentioning `lost+found`, or `Permission denied` / `could not change permissions of directory`. (**Expected**; not observed on the reference machine, where Postgres started cleanly. The chart is built to avoid it.)

**Cause.** `initdb` refuses a data directory that contains anything (some storage classes put `lost+found` at the volume root), and the postgres user must own the directory. The chart therefore sets `PGDATA=/var/lib/postgresql/data/pgdata` (a subdirectory of the volume) and runs the pod as uid/gid 999 with `fsGroup` 999 so the volume is writable.

**Fix.** Check that those settings are intact: `kubectl -n gateway get statefulset postgres -o yaml` (look for `PGDATA`, `runAsUser: 999`, `fsGroup: 999`). Do not point `PGDATA` at the volume root. If a volume was created by something else with other ownership, and you accept losing the gateway's data, delete the claim and let it initialise again: `kubectl -n gateway delete statefulset postgres`, `kubectl -n gateway delete pvc data-postgres-0`, then `scripts\up.ps1 -Redeploy` (**destroys users, keys and the audit log**; the bootstrap admin is created again with the password in `gateway-bootstrap`).

## Gateway, Notes or Utilities pod in `ErrImagePull`

**Symptom.** `kubectl -n gateway get pods` or `kubectl -n mcp get pods` shows `ErrImagePull`, `ErrImageNeverPull` or `ImagePullBackOff` for `gateway-...`, `mcp-notes-...` or `mcp-utilities-...`, naming an image such as `urumi/gateway:dev`.

**Cause and fix.** The same as for the WooCommerce MCP server ([above](#mcp-woocommerce-is-in-errimageneverpull-or-imagepullbackoff)): the cluster has no registry, and the pod asks for a tag the cluster does not hold. `scripts\build-images.ps1` now builds **four** images (`mcp-woocommerce`, `mcp-notes`, `mcp-utilities`, `gateway`), imports each into the cluster and writes the tag to `deploy\.images.local.yaml`; `scripts\up.ps1 -Redeploy` runs it for you. The usual cause is deploying with `deploy.ps1` on a fresh clone, or recreating the cluster, without building. Fix: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\up.ps1 -Redeploy`. (**Expected** for the new images; the failure itself was not reproduced, the fix is the one verified for `mcp-woocommerce`.) If `docker build` fails for one of them, make sure Docker Desktop is running and that `npm ci`'s lockfile (`package-lock.json`) is committed.

## Upgrade fails: `spec.strategy.rollingUpdate: Forbidden`

**Symptom.** `helm upgrade` stops with `Deployment.apps "gateway" is invalid: spec.strategy.rollingUpdate: Forbidden: may not be specified when strategy type is 'Recreate'`, and the release shows `failed`.

**Cause.** The gateway Deployment now uses the `Recreate` strategy. An install made before that change still carries the `rollingUpdate` block that Kubernetes filled in by default, and Helm's server-side apply cannot remove a field that no field manager owns (an explicit `rollingUpdate: null` in the template does not help either; checked with a server-side dry run).

**Fix.** `scripts\deploy.ps1` (and so `up.ps1 -Redeploy`) switches the live Deployment to `Recreate` before running Helm, once; this restarts nothing. If you run `helm` yourself, do the same first, then upgrade again (PowerShell 5.1 mangles JSON quotes in native arguments, so the patch goes through a file):

```powershell
Set-Content -Path "$env:TEMP\recreate.json" -Value '{"spec":{"strategy":{"type":"Recreate","rollingUpdate":null}}}' -Encoding ascii
kubectl -n gateway patch deployment gateway --type merge --patch-file "$env:TEMP\recreate.json"
```

## PowerShell gotchas with kubectl

- **Comma-separated names:** `kubectl -n store get secret store-db,store-admin,store-woo-api` fails in PowerShell with `secrets "store-db,store-admin,store-woo-api" not found` **(observed)**, because the argument is passed as one string. Use spaces: `kubectl -n store get secret store-db store-admin store-woo-api`.
- **Quotes inside `sh -c '...'`:** Windows PowerShell 5.1 strips inner double quotes from native-command arguments; escape them as `\"` (as in the MariaDB check above).
- **`>` redirection** writes UTF-16 in PowerShell 5.1; use `cmd /c "... > file"` for text dumps.
- **`-o jsonpath` templates containing quotes** (such as `{"\n"}` for a newline) break in Windows PowerShell 5.1 because the inner double quotes are stripped when the argument is passed to `kubectl`, which then reports `unrecognized character in action` (**observed**); convert with `-o json | ConvertFrom-Json` instead.
- **`Invoke-RestMethod` and the gateway (verified 2026-10-19).** Mutating calls need `-Headers @{ Origin = 'http://app.localhost' } -ContentType 'application/json'` every time, even `DELETE`. Assign a list response to a variable before piping it (`$keys = Invoke-RestMethod ...; $keys | Select-Object ...`); piping `Invoke-RestMethod` straight into `Select-Object`, `Where-Object` or `Format-Table` printed an empty row for `/api/users`, `/api/keys` and `/api/servers`, and `Where-Object` on the unassigned result found nothing. After a first call that used `-Headers`, a later call on the same `-WebSession` still sent the `Origin` header although it was not passed again, so a test of "missing Origin" must use a fresh session. To read an error body use `$_.ErrorDetails.Message` inside `catch`.
- **JSON on the `curl.exe` command line.** PowerShell 5.1 strips the double quotes from a JSON string passed as an argument; write the body to a file and send `--data-binary "@file"` (run guide, section 9).

## Chat says the AI provider isn't configured

**Symptom.** The Chat page shows "The AI provider isn't configured" instead of the message box (or a send answers `503 LLM_NOT_CONFIGURED`). `up.ps1` prints a yellow `AI chat : not set up` line.

**Diagnose.**

```powershell
kubectl -n gateway get secret llm-api-keys -o name                 # does the Secret exist? (prints only its name)
kubectl -n gateway logs deploy/gateway | Select-String "llm "      # "llm configured: ..." or "llm not configured: chat is disabled"
```

**Causes and fixes.**

1. **The Secret was never created.** Follow the run guide's [Set up the AI chat](run-guide.md#set-up-the-ai-chat): key into `.env`, then `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\create-secrets.ps1`.
2. **The key for the configured provider is empty.** The gateway needs the key of `gateway.llm.provider` (Groq by default). `create-secrets.ps1` prints `GROQ_API_KEY: empty` in that case; fix the line in `.env` (`GROQ_API_KEY=<key>`, no spaces around `=`) and run it again. With `provider: openrouter`, `OPENROUTER_API_KEY` is the one that matters.
3. **The gateway was not restarted after the Secret changed.** A pod reads Secret values only when it starts. The script restarts it unless you passed `-NoRestart`; otherwise run `kubectl -n gateway rollout restart deploy/gateway`.
4. **A pre-created Secret with another name** (`secrets.existing.llmApiKeys`): `create-secrets.ps1` always writes `llm-api-keys`, so either name yours `llm-api-keys` or create yours with the keys `GROQ_API_KEY` and `OPENROUTER_API_KEY` by hand (known limitation).

Verified 2026-10-19: before the Secret existed the log said `llm not configured: chat is disabled` and the pod ran normally; after `create-secrets.ps1` it said `llm configured: groq/openai/gpt-oss-120b`.

## Chat says the AI provider rejected the API key (`LLM_AUTH_FAILED`)

**Symptom.** "The AI provider rejected the API key. An admin needs to update it." (HTTP 502 `LLM_AUTH_FAILED`). The gateway log has a `chat turn` warning with `"code":"LLM_AUTH_FAILED"` and `"httpStatus":401` (or 403).

**Cause.** The provider refused the key: it was mistyped or truncated when pasted into `.env`, revoked or deleted in the provider's console, or it belongs to another provider than `gateway.llm.provider` (an OpenRouter key in `GROQ_API_KEY`, for example). Not retried, because repeating it cannot help (**tested**; not forced live).

**Fix.** Create a new key in the provider's console ([ai-integration.md](ai-integration.md#3-getting-a-free-key)), replace the line in `.env`, and run `scripts\create-secrets.ps1` again (it restarts the gateway). Never paste the key into a chat or an issue to ask for help; `create-secrets.ps1` only says `set` or `empty`, and that is enough to share.

## Chat says the AI provider is rate limited (429)

**Symptom.** "The AI provider is rate limited. Try again in N seconds." with a countdown; Retry is disabled until it reaches 0. The response is `429 LLM_RATE_LIMITED` with a `Retry-After` header (the provider's value, or 60 s when it gave none). Not to be confused with "You're sending messages too quickly." (`429 RATE_LIMITED`), which is the gateway's own limit of 10 messages per minute per person.

**Cause.** The free plan's limits: Groq allows 30 requests and **8,000 tokens per minute**, 1,000 requests and 200,000 tokens per day for `openai/gpt-oss-120b` (2026-10-19). A one-tool question costs about 3,000 tokens (two model calls with the 15 tool schemas), so two or three quick questions within a minute can hit the per-minute limit; one shared key serves the whole team. The gateway already retried up to 2 times when the provider asked for a wait of 20 s or less, without passing the 60 s turn deadline, and tried the fallback if one is configured. A longer wait (Groq sends one when the **daily** quota is spent, often an hour or more) is not retried: the error comes back at once with the provider's full `Retry-After`, and the fallback is tried immediately if configured. A countdown of many minutes therefore means the daily quota, not the per-minute one.

**Fix.** Wait for the countdown, then press Retry (check the "These actions already ran" list first, if shown). If it happens daily: keep questions narrow, configure the OpenRouter fallback (`gateway.llm.fallbackProvider: openrouter` plus `OPENROUTER_API_KEY`; not tested live through the gateway), or check your usage in the Groq console. The gateway log line shows `"httpStatus":429` and, when a fallback was tried, `fallbackProvider` and `fallbackCode`.

## Chat says the AI provider is unavailable, or the answer was unexpected

**Symptom.** "The AI provider is unavailable right now." (`502 LLM_UNAVAILABLE`) or "The AI returned an unexpected answer. Try rephrasing." (`502 LLM_BAD_RESPONSE`).

**Causes.** *Unavailable:* no internet from the cluster, the provider is down (5xx), or one request took longer than `LLM_TIMEOUT_MS` (30 s); the gateway retried twice. *Unexpected answer:* the model produced a broken tool call (Groq `tool_use_failed`, retried once) or an answer the adapter could not read, or a `gateway.llm.model` that the provider does not know (a 400/404 is reported this way too).

**Fix.** Check the cluster's internet access (`kubectl -n gateway exec deploy/gateway -- node -e "fetch('https://api.groq.com').then(r=>console.log(r.status))"`; **expected** to print a status, not run) and the provider's status page; for a bad answer, rephrase, or check `gateway.llm.model` against the provider's model list and redeploy. The log line's `httpStatus` and `providerCode` say which case it was.

## The dashboard is blank, or a refresh gives 404

**Symptom.** `http://app.localhost/` shows a white page, the browser's 404 page, or a "404 page not found" from Traefik; or a page works when clicked but a browser refresh on it (for example `/servers/<id>`) gives 404.

**Diagnose.**

```powershell
kubectl -n gateway get pods                          # dashboard-... 1/1 Running?
kubectl get ingress -n gateway gateway -o yaml | Select-String "path:"   # expect /api, /mcp and /
curl.exe -s -o NUL -w "%{http_code}\n" http://app.localhost/servers      # expect 200
kubectl -n gateway logs deploy/dashboard --tail=20
```

**Causes and fixes.**

- **No dashboard pod or no `/` path:** the release predates Phase 4, or `dashboard.enabled` is false. Run `scripts\up.ps1 -Redeploy`.
- **Traefik's own "404 page not found":** the Ingress has no `/` rule (see above), or the host is not `app.localhost`.
- **A refresh on a deep link gives nginx's 404:** the image's `nginx.conf` lost its `try_files $uri /index.html` fallback (it is in `apps/dashboard/nginx.conf`); rebuild with `up.ps1 -Redeploy`. Paths under `/assets/` and `/.well-known/` answer 404 on purpose when the file does not exist.
- **A white page with no error:** open the browser's developer tools (F12) → Console. A `Content-Security-Policy` error means something tried to load a script from another origin (a browser extension can cause this); a failed `/assets/index-….js` means the page and its assets come from different builds, so reload with Ctrl+F5 (`index.html` is never cached, the assets are).

Verified 2026-10-19: `/` and `/servers` answer 200 with the security headers, `/.well-known/oauth-authorization-server` answers 404, a missing asset answers 404.

## `check-dashboard.ps1` says Playwright Chromium is not installed

**Symptom.** The script prints `Playwright Chromium is not installed. Run this once, then run this script again:` and `npx playwright install chromium`, then exits 1. Or it stops earlier with `Dependencies not installed: run npm ci`.

**Fix.** From the repository root: `npm ci` (if the second message), then `npx playwright install chromium` (about 118 MiB, into `%LOCALAPPDATA%\ms-playwright`; only Chromium is needed). Run it again after an update of `@playwright/test`, because each Playwright version expects its own browser build. Behind a proxy, Playwright needs `HTTPS_PROXY` set to download (**expected**, not tested). Verified 2026-10-19: the message appears when `PLAYWRIGHT_BROWSERS_PATH` points at an empty folder, and the install fixes it.

Other failures of this script: `app.localhost does not resolve` (run `scripts\setup-hosts.ps1` once, as for the other Node checks), `Could not read secret gateway/gateway-bootstrap` (the platform is not deployed: `up.ps1`), and a failing test, whose name and assertion Playwright prints (nothing is recorded, so re-run with the cluster healthy: `kubectl get pods -A`).

## The Vite dev server gives 403 `CSRF_REJECTED`

**Symptom.** While developing the dashboard with `npm run dev -w @urumi/dashboard`, logging in or any change at `http://localhost:5173` fails with `403 CSRF_REJECTED`.

**Cause.** The gateway accepts a mutating call only with `Origin: http://app.localhost`. The dev server's proxy rewrites `Origin` to that value **only** when the request has no `Origin` or comes from `http://localhost:5173` or `http://127.0.0.1:5173`; any other origin is passed through so the gateway can refuse it. So a 403 means the page was opened under another address (a LAN IP, another port, a different host name), or something else sent the request.

**Fix.** Open the dev server exactly at `http://localhost:5173` (port 5173 is fixed with `strictPort`; if it is taken, the dev server stops instead of moving to another port, so free the port). Do not loosen the gateway's CSRF check. The cluster must be up, because the proxy forwards to `http://app.localhost`. Verified in Task 4.3 with `curl.exe` through the proxy: login with the dev origin 200, with `Origin: http://evil.example` 403.

## The dashboard pod is in `ErrImagePull` (image tag not found)

**Symptom.** `kubectl -n gateway get pods` shows `dashboard-...` in `ErrImagePull` or `ImagePullBackOff`, naming an image such as `urumi/dashboard:dev` or a tag the cluster does not hold.

**Cause and fix.** The same as for the other images ([above](#gateway-notes-or-utilities-pod-in-errimagepull)): the cluster has no registry, so the tag must have been built and imported. `scripts\build-images.ps1` builds five images now, including `urumi/dashboard` from `docker/dashboard.Dockerfile`, with one shared tag written to `deploy\.images.local.yaml`. Fix: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\up.ps1 -Redeploy`. If the Docker build of the dashboard fails at `npm ci`, the lockfile and `apps/dashboard/package.json` disagree: run `npm install` locally, commit `package-lock.json`, and redeploy. (**Expected**; the failure itself was not reproduced for the dashboard.)

## `npm ci` prints `EBADENGINE` warnings for jsdom

**Symptom.** `npm ci` or `npm install` prints `npm warn EBADENGINE Unsupported engine` for `jsdom@30.1.3` and some `@asamuzakjp/*` packages, naming `node: '^22.22.2 || ^24.15.0 || >=26'`.

**Cause and fix.** jsdom 30 (the dashboard's test environment) declares Node 24.15 or newer; the reference machine has Node 24.0.1. The warnings are harmless there (all 113 dashboard tests pass), and the Docker images use a newer `node:24-alpine`. To silence them, update Node to 24.15 or newer (`winget upgrade OpenJS.NodeJS.LTS`, **expected**, not run here).


## A pod cannot reach X after Phase 5

**Symptom.** A connection from one pod to another pod or to the internet fails with `Connection refused` (curl exit 7) or hangs until a timeout (exit 28), although the target is running and its Service has endpoints. A new feature that calls a new host or port fails from inside the cluster.

**Cause.** The `store`, `mcp` and `gateway` namespaces are default-deny for ingress and egress ([ADR-016](decisions/ADR-016-default-deny-network-policies.md)). Only the flows in the allow matrix ([security.md, section 15](security.md#15-networkpolicies-phase-5)) are open: Traefik to wordpress, gateway and dashboard; gateway to the MCP servers and Postgres; mcp-woocommerce to WordPress; WordPress, store-setup and wp-cron to MariaDB; Traefik to cert-manager's HTTP-01 solver pods (production TLS only); and 443/80 to public IPs from the gateway, WordPress, store-setup and wp-cron. DNS is open for all pods. Private ranges (`10/8`, `172.16/12`, `192.168/16`, `169.254/16`, `100.64/10`, `127/8`) are never reachable through the internet rules.

**Fix.**

```powershell
kubectl get networkpolicy -A                          # the policies in force
kubectl -n gateway describe networkpolicy gateway     # one policy: selectors, ports
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\test-network-policies.ps1   # is the designed behaviour intact?
```

- If the flow is meant to exist, add one rule for it in `charts/urumi-platform/templates/network/` (pod labels are `app.kubernetes.io/instance` plus `app.kubernetes.io/name`) and redeploy; also add the row to the allow matrix and the probe script.
- Only to confirm that a policy is the cause, redeploy with `--set networkPolicies.enabled=false` (local use only), then turn it back on.
- A **brand-new pod** can behave oddly for its first 3 to 6 seconds: kube-router programs its rules a little after it starts, so an allowed call may be refused and a blocked one may succeed. Wait a few seconds and retry; the probe script does the same.
- `kubectl port-forward`, `exec` and kubelet probes are not affected by NetworkPolicies.


## `forbidden: violates PodSecurity`

**Symptom.** Creating a pod (or a Deployment's ReplicaSet, or `kubectl run`) in `store`, `mcp` or `gateway` fails with `forbidden: violates PodSecurity "restricted:latest": ...` and a list such as `allowPrivilegeEscalation != false`, `unrestricted capabilities`, `runAsNonRoot != true` or `seccompProfile`.

**Cause.** The three namespaces enforce Pod Security `restricted` ([ADR-017](decisions/ADR-017-pod-security-restricted.md)); the pod does not set the required security context. For a Deployment the Deployment is created but its ReplicaSet reports the error in events.

**Fix.** Fix the pod spec, do not lower the level:

```powershell
kubectl -n <ns> get events --field-selector reason=FailedCreate
kubectl -n <ns> describe replicaset <name>
```

Set at pod level `runAsNonRoot: true`, `runAsUser: <non-zero>` and `seccompProfile: {type: RuntimeDefault}`, and at container level `allowPrivilegeEscalation: false` and `capabilities: {drop: [ALL]}`. For a throw-away `kubectl run`, add `--overrides` with those fields (see the probe pods in `scripts\test-network-policies.ps1`) or run it in another namespace. Chart pods use the `urumi.podSecurityContext` and `urumi.containerSecurityContext` helpers. Check a change against the cluster before applying it: `kubectl label --dry-run=server --overwrite ns store mcp gateway pod-security.kubernetes.io/enforce=restricted` prints a warning for every existing pod that would be refused.


## Another computer or phone can no longer open the local store

**Symptom.** `http://<your computer's address>/` from a phone or another PC on the same network gets no answer ("connection refused" or a timeout), although it worked before 2026-10-23.

**Cause.** On purpose: the local cluster publishes ports 80 and 443 on `127.0.0.1` only (`deploy/k3d-config.yaml`; verified: a request to the Wi-Fi address gets curl exit 7). Only programs on this computer can reach it.

**Fix.** Nothing is broken. To show the store to someone else use a screen share, or the production path in [deployment.md](deployment.md#production-k3s-vps). Do not change the mapping back to `80:80` unless you accept that anyone on the network can reach the store and the gateway login. Changing the mapping needs `scripts\cluster-down.ps1` and `scripts\up.ps1`, which delete all data.

## `smoke-test.ps1` fails at one step

**Symptom.** The summary table shows a `FAIL` row and the script exits 1.

**Diagnose.** The table shows only the last output line of the failing step. Run that step alone for the full output:

| Step | Run alone | Common cause and link |
|---|---|---|
| 1 pods ready | `kubectl get pods -A` | a pod not 1/1: `kubectl -n <ns> describe pod <name>`, [PVC stays Pending](#pvc-stays-pending), or the cluster was only just started |
| 2 check-woo-api | `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check-woo-api.ps1` | the store-setup Job has not finished |
| 3 check-mcp-woocommerce | `scripts\check-mcp-woocommerce.ps1` | a NetworkPolicy or token problem, see [the MCP server answers 401](#the-mcp-server-answers-401-unauthorized) |
| 4 check-gateway -Write | `scripts\check-gateway.ps1 -Write` | see [`/mcp` answers 401 on the gateway](#mcp-answers-401-on-the-gateway) |
| 5 check-dashboard | `scripts\check-dashboard.ps1` | Chromium missing (`npx playwright install chromium`), or the chat provider is rate limited (a live chat turn runs here) |
| 6 test-network-policies | `scripts\test-network-policies.ps1` | [A pod cannot reach X after Phase 5](#a-pod-cannot-reach-x-after-phase-5) |
| 7 invite-log check | `scripts\check-invite-log.ps1` | "holds the random invite value N time(s)": the dashboard's nginx log format lost its redaction (`apps/dashboard/nginx.conf`); "Positive control failed": the dashboard pod is not serving or not logging |
| 8 npm audit | `npm audit --omit=dev --audit-level=high` | a new advisory: update the exact pin if a patched non-breaking version exists, otherwise record it in [security.md](security.md) |

`-Quick` skips steps 5 and 8.

## After recreating the cluster, old passwords and API keys stop working

**Symptom.** After `cluster-down.ps1` and `up.ps1` the saved admin passwords, database passwords and any MCP client's API key are rejected (`401`, `Access denied`), and the chat says the AI provider is not configured.

**Cause.** Recreating the cluster deletes everything, including every generated Secret; the new install generates new passwords, and the gateway database (users, keys, audit log) is empty. The AI keys are not generated by Helm.

**Fix.** Fetch the new passwords with the commands in [section 5 of the run guide](run-guide.md#5-passwords-and-secrets), create new API keys in the dashboard and update your MCP clients, and run `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\create-secrets.ps1` once to restore the AI keys from `.env`.

## The gateway restarted once or twice on a first install

**Symptom.** On a brand-new cluster `kubectl -n gateway get pods` showed the `gateway` pod with `RESTARTS 2` while Postgres was still starting (seen on the first install of 2026-10-23 and in the production rehearsal).

**Cause (found 2026-10-23).** The gateway waited 30 x 2 s for Postgres and its startup probe allowed 60 x 2 s. On a new cluster the Postgres image is pulled first (`Successfully pulled image "postgres:17.11-bookworm" in 1m51s`), which is longer than the wait, so the gateway gave up and Kubernetes restarted it; the startup probe also killed it once (`Container gateway failed startup probe`). It was harmless but looked like a failure.

**Fix (in the chart and the gateway since commit `027d43e`).** The gateway waits 90 x 2 s (180 s) and the startup probe allows 110 x 2 s (220 s). Verified: on the next full recreation (images pulled from the registry again, Postgres pull 1m35s) the gateway had **0 restarts**; and with Postgres scaled to 0 for 110 s while a gateway started, it stayed at 0 restarts and became ready when Postgres returned. If you still see restarts on a very slow connection, read `kubectl -n gateway describe pod -l app.kubernetes.io/name=gateway` (the Events show whether the probe or the exit caused it) and [the CrashLoopBackOff entry](#the-gateway-pod-is-in-crashloopbackoff-database-not-ready-after-90-attempts).

## A certificate stays `READY False`

**Symptom.** In production `kubectl get certificate -A` shows `urumi-tls-store` or `urumi-tls-app` with `READY False` for more than a few minutes. Traefik serves its default self-signed certificate, and because of the http-to-https redirect the site is unusable in a browser.

**Diagnose.**

```bash
kubectl get challenges -A                       # one per host while issuance is pending
kubectl describe challenge -n store <name>      # the Reason / Status line says what failed
kubectl -n store get pods -l acme.cert-manager.io/http01-solver=true
kubectl -n store get networkpolicy acme-http01-solver
kubectl -n cert-manager logs deploy/cert-manager --tail=100
```

**Causes and fixes.**

- **The self-check cannot reach the solver** (`Waiting for HTTP-01 challenge propagation: failed to perform self check GET request ... connection refused` or a timeout). Check that the policy `acme-http01-solver` exists in that namespace. The chart renders it only with `global.tls.enabled: true`, a non-empty `global.tls.clusterIssuer` and `networkPolicies.enabled: true`. Without it, the default-deny policy drops Traefik's request to the solver on port 8089. Fixed in the chart since the Phase 5 final review. The policy's effect was verified on the local cluster on 2026-10-23 with a stand-in solver pod (ADR-016); a real Let's Encrypt issuance is **expected; not tested**.
- **DNS does not point at the server yet**, or ports 80/443 are closed in the provider's firewall. `nslookup store.yourdomain.com` must give the server's public IP, and port 80 must be open: the HTTP-01 challenge always arrives on port 80.
- **The solver pod is refused by Pod Security** (`kubectl -n store get events` shows `violates PodSecurity`). cert-manager v1.21.2 builds the solver `restricted`-compliant by default. If you added `podTemplate.spec.securityContext` to the ClusterIssuer, it replaces the whole pod security context: repeat `runAsNonRoot: true` and `seccompProfile: {type: RuntimeDefault}` there (see the comment in `deploy/prod/cluster-issuer-letsencrypt.yaml`).
- **Let's Encrypt rate limits** after many attempts: use the staging server while testing ([deployment.md, step 5](deployment.md#5-cert-manager-and-the-certificate-issuer)).

## Scheduled WordPress work does not run (`wp-cron` CronJob)

**Symptom.** Unpaid orders keep their stock reserved, scheduled sales do not start, or WooCommerce > Status > Scheduled Actions shows many **past-due** actions. Alternatively, `kubectl -n store get jobs` shows `wp-cron-...` Jobs with `Failed`.

**Cause.** The chart sets `DISABLE_WP_CRON` and runs WordPress's due events every 5 minutes from the CronJob `wp-cron` ([ADR-018](decisions/ADR-018-wordpress-cron-via-cronjob.md)). WordPress's own loopback request to its public URL is blocked by the NetworkPolicies on a VPS, so nothing else runs them.

**Diagnose.**

```powershell
kubectl -n store get cronjob wp-cron              # SUSPEND False; LAST SCHEDULE within the last 5 minutes
kubectl -n store get jobs                         # the last wp-cron-<n> Job: Complete
kubectl -n store logs job/<the last wp-cron Job>  # "Success: Executed a total of N cron events." (N can be 0)
kubectl -n store create job wp-cron-manual --from=cronjob/wp-cron   # run it now
kubectl -n store logs job/wp-cron-manual; kubectl -n store delete job wp-cron-manual
```

**Fixes.**

- `[wp-cron] database not reachable within 60s; last error: ...`: MariaDB is down or its policy does not admit `app.kubernetes.io/name=wp-cron` (`kubectl -n store describe networkpolicy mariadb`). See [the MariaDB entry](#mariadb-crashloopbackoff-or-wordpress-cannot-reach-the-database).
- `Error: Error establishing a database connection.` in under a second, from a chart older than the Phase 5 final review: a new pod connected before kube-router had admitted its IP (observed 2026-10-23). The current chart waits for the database first; redeploy.
- No `wp-cron` CronJob at all: `wordpress.cron.enabled` is `false` in your values. WordPress then uses its built-in WP-Cron, which needs the loopback to its public URL.
- `DeadlineExceeded`: one run took longer than 4 minutes (`activeDeadlineSeconds: 240`); look for a slow plugin event in the log. The next run continues with the remaining events.

## The external store answers 401 or 403, or the MCP server cannot reach it

Applies to `mcpWoocommerce.externalStore` ([ADR-019](decisions/ADR-019-external-woocommerce-store.md), [deployment](deployment.md#using-a-woocommerce-store-hosted-elsewhere)). The chart's external mode is rendered, not installed; the causes below are the expected ones except where marked.

**Symptom.** A tool returns `WooCommerce request failed (rest_cannot_view)` / HTTP 401 or 403, or `Could not reach WooCommerce (network error)`.

**Diagnose.**

```powershell
kubectl -n mcp logs deploy/mcp-woocommerce --tail=20            # start-up message: variable names only
kubectl -n mcp get pod -l app.kubernetes.io/name=mcp-woocommerce # CreateContainerConfigError = the Secret is missing
kubectl -n mcp describe networkpolicy mcp-woocommerce            # the egress rules the pod really has
```

**Causes and fixes.**

- **The pod does not start and the log names `WOO_BASE_URL`.** The URL must start with `https://` and must not contain a user name or password. Fix `mcpWoocommerce.externalStore.url`. (`helm template` refuses these values, so this appears only with hand-edited env.)
- **`CreateContainerConfigError`.** The Secret named in `externalStore.existingSecret` does not exist in namespace `mcp`, or lacks the keys `consumer-key` and `consumer-secret`.
- **401 on every call although the key is right: the host strips the `Authorization` header** (expected; not tested). Some hosts, mostly PHP running as CGI/FastCGI behind Apache, do not hand the header to WordPress, so WooCommerce sees no credentials. The usual fix is on the store's side: add `RewriteRule .* - [E=HTTP_AUTHORIZATION:%{HTTP:Authorization}]` to `.htaccess` (or the host's equivalent setting), then retry. Ask the host if you cannot edit it. Do not move the key into the URL: the MCP server and the chart refuse that on purpose.
- **401 or 403 with the header passing.** The key was revoked, was created with **Read** only (writes then fail with 401/403), belongs to a user who cannot manage the shop, or the Secret holds an old value. Create a new Read/Write key, update the Secret, then `kubectl -n mcp rollout restart deploy/mcp-woocommerce` (the pod reads the Secret only at start).
- **`Could not reach WooCommerce (network error)`.** One of: DNS for the host; a TLS problem (the certificate is self-signed, expired, for another host name or signed by a CA that Node does not trust: the server never skips verification); or the egress rule. The pod may only reach the public internet (443, 80) outside the private ranges, plus `extraEgressCIDRs` on 443. A store on a private address needs its network listed there.
- **Redirects.** The client does not follow them, so a store URL that redirects (for example `http` to `https`, or to a `www` host) fails. Use the final `https://` address as `externalStore.url`.
- **Wrong "today".** `list_orders` with `period` uses `storeSetup.timezone`; set it to the store's time zone.
