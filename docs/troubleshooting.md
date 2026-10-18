# Troubleshooting

> **Status (end of Phase 1).** Covers the local k3d cluster and the store. Gateway, MCP-server and dashboard problems are added in later phases.

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
- [PowerShell gotchas with kubectl](#powershell-gotchas-with-kubectl)

---

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

**Fix.** If the namespace is empty and you created it yourself: `kubectl delete ns store` (destroys anything in it) and run `deploy.ps1` again. Do not create the three namespaces by hand.

**Reinstall after uninstall works, with a condition.** After `helm uninstall urumi -n urumi-system`, the kept namespaces, PVCs and Secrets still carry the annotations `meta.helm.sh/release-name: urumi` and `release-namespace: urumi-system`. A reinstall is therefore adopted cleanly (verified in Task 1.5) **only with the same release name and namespace** (`urumi` / `urumi-system`). Installing under a different name or namespace hits the ownership error above. To start over under another name, delete the kept objects first (`kubectl delete ns store mcp gateway`, **destroys data**).

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

1. **Secret and data volume out of sync (leftover data with a different password).** The MariaDB image applies `MARIADB_ROOT_PASSWORD`/`MARIADB_PASSWORD` **only when it initialises an empty data directory**. If the volume `data-mariadb-0` survived but the Secret `store-db` was deleted and regenerated, MariaDB starts normally but with passwords nobody knows. This is why the chart annotates the generated Secrets with `helm.sh/resource-policy: keep` and why `helm uninstall` keeps both Secrets and PVCs. Fix: restore the original Secret if you still have it; otherwise accept the loss and delete both together (`kubectl delete ns store` destroys the store), then run `deploy.ps1`. Never delete only one of the two.
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

1. **Wrong signing base.** It must be `http://<WP_HOME host>[:port]`. If you changed `global.publicPort` (e.g. 8081), the base must include the port, but `check-woo-api.ps1` only derives the host: run `node scripts/dev/woo-oauth-check.mjs --target http://127.0.0.1:<pf-port> --sign-base http://store.localhost:8081` yourself with the key in `WOO_CONSUMER_KEY`/`WOO_CONSUMER_SECRET`. Also the scheme is always `http` for non-TLS requests, even if the public URL is `https` behind a proxy that does not forward the scheme.
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

**Fix.** Create the Secrets in namespace `store` with exactly these keys: `storeDb`: `root-password` and `password`; `storeAdmin`: `password`; `storeWooApi`: `consumer-key` and `consumer-secret`, with the consumer secret at most **43 characters** (WooCommerce stores it in a `char(43)` column; a longer value cannot be inserted by the setup Job). Diagnose with `kubectl -n store describe pod <name>` and `kubectl -n store get secret <name> -o jsonpath='{.data}'` (shows key names; values are base64, do not share them).

## PowerShell gotchas with kubectl

- **Comma-separated names:** `kubectl -n store get secret store-db,store-admin,store-woo-api` fails in PowerShell with `secrets "store-db,store-admin,store-woo-api" not found` **(observed)**, because the argument is passed as one string. Use spaces: `kubectl -n store get secret store-db store-admin store-woo-api`.
- **Quotes inside `sh -c '...'`:** Windows PowerShell 5.1 strips inner double quotes from native-command arguments; escape them as `\"` (as in the MariaDB check above).
- **`>` redirection** writes UTF-16 in PowerShell 5.1; use `cmd /c "... > file"` for text dumps.
- **`\n` in `-o jsonpath` templates** is not understood when passed through PowerShell; convert with `-o json | ConvertFrom-Json` instead (**observed**).
