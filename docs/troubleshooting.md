# Troubleshooting

> **Status (end of Phase 2).** Covers the local k3d cluster, the store and the WooCommerce MCP server. Gateway and dashboard problems are added in later phases.

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
- [PowerShell gotchas with kubectl](#powershell-gotchas-with-kubectl)

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

## PowerShell gotchas with kubectl

- **Comma-separated names:** `kubectl -n store get secret store-db,store-admin,store-woo-api` fails in PowerShell with `secrets "store-db,store-admin,store-woo-api" not found` **(observed)**, because the argument is passed as one string. Use spaces: `kubectl -n store get secret store-db store-admin store-woo-api`.
- **Quotes inside `sh -c '...'`:** Windows PowerShell 5.1 strips inner double quotes from native-command arguments; escape them as `\"` (as in the MariaDB check above).
- **`>` redirection** writes UTF-16 in PowerShell 5.1; use `cmd /c "... > file"` for text dumps.
- **`-o jsonpath` templates containing quotes** (such as `{"\n"}` for a newline) break in Windows PowerShell 5.1 because the inner double quotes are stripped when the argument is passed to `kubectl`, which then reports `unrecognized character in action` (**observed**); convert with `-o json | ConvertFrom-Json` instead.
