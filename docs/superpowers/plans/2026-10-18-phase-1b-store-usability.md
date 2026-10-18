# Phase 1b — Store usability: one-command start, customer accounts, run guide

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
1. Start the whole local project with one command that prints clickable store URLs and never prints secrets.
2. Let shoppers create accounts so they can see their order history under My Account.
3. Add one central run guide (`docs/run-guide.md`) that every later phase extends.

**Architecture:**
- **Scripts:** a new `scripts/up.ps1` wraps the existing `cluster-up.ps1` and `deploy.ps1`.
  - It runs `deploy.ps1` only when the release doesn't exist yet, or when `-Redeploy` is passed.
  - It waits for the store pods, then prints URLs computed from the release's Helm values.
- **Other new scripts:** `scripts/stop.ps1` stops the cluster. `scripts/get-admin-password.ps1` copies the password to the clipboard and prints it only with `-Show`.
- **Customer accounts:** a few WooCommerce options in the setup Job's `setup.sh`.
- **Docs only:** `docs/run-guide.md` becomes the single "how to run everything" document.

**Tech Stack:** PowerShell 5.1, Helm 4.3.1, kubectl, WP-CLI (`wordpress:cli-2.12.0-php8.3`), WooCommerce 11.2.1.

**Branch:** `phase-1-store`. Phase 1 isn't merged yet, so this is part of Phase 1.

## Global Constraints

- **Git:** never push; no Co-Authored-By / Claude / AI attribution in commits; conventional commit prefixes.
- **No secrets in output:**
  - Scripts must never print passwords, keys or tokens to the console or logs.
  - They print the command that retrieves a secret instead.
  - The only exception is `get-admin-password.ps1 -Show`, which the user runs explicitly.
- **PowerShell 5.1 rules:**
  - Check `$LASTEXITCODE` after every native call.
  - Probe commands that may legitimately fail (e.g. `docker info`, `helm status`) with `cmd /c "<cmd> >nul 2>&1"`. Under `$ErrorActionPreference='Stop'`, PS 5.1 turns native stderr redirected with `2>&1` into terminating errors.
  - The repo path contains spaces, so quote paths.
- **Line endings:** `*.ps1` CRLF, everything else LF (`.gitattributes` handles this).
- **Docs honesty:** only describe what exists and was verified. Phase 2+ parts of the run guide are marked **(planned — Phase N)**.
- **Existing behavior unchanged:**
  - `deploy.ps1`, `cluster-up.ps1` and the chart keep working exactly as before.
  - Customer accounts are additive WooCommerce options.

---

### Task 1: One-command start/stop and admin-password helper

**Files:**
- Create: `scripts/up.ps1`, `scripts/stop.ps1`, `scripts/get-admin-password.ps1`

**Interfaces (produces):**
- `scripts\up.ps1 [-Redeploy] [-Open]`: exit 0 after printing a URL block; exit 1 with a clear message on any failure.
- `scripts\stop.ps1`: stops the k3d cluster and keeps the data.
- `scripts\get-admin-password.ps1 [-Show]`: copies the WordPress admin password to the clipboard. `-Show` prints it.

- [ ] **Step 1: Write `scripts/up.ps1`**

```powershell
# One-command local start for the Urumi platform.
#   powershell -ExecutionPolicy Bypass -File scripts\up.ps1            # start; installs the release only if missing
#   powershell -ExecutionPolicy Bypass -File scripts\up.ps1 -Redeploy  # also apply chart/value changes (helm upgrade)
#   powershell -ExecutionPolicy Bypass -File scripts\up.ps1 -Open      # also open the storefront in the browser
# Never prints passwords: it prints the command that retrieves them.
[CmdletBinding()]
param([switch]$Redeploy, [switch]$Open)
$ErrorActionPreference = 'Stop'

function Stop-WithError([string]$Message) {
  Write-Host "ERROR: $Message" -ForegroundColor Red
  exit 1
}

foreach ($tool in 'docker', 'k3d', 'kubectl', 'helm') {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
    Stop-WithError "'$tool' was not found on PATH. Install it (docs/run-guide.md) or open a NEW terminal so PATH refreshes."
  }
}

# 1. Docker Desktop must be running (k3d runs Kubernetes inside Docker containers).
cmd /c "docker info >nul 2>&1"
if ($LASTEXITCODE -ne 0) { Stop-WithError 'Docker is not running. Start Docker Desktop, wait for "Engine running", then run this again.' }

# 2. Start (or create) the k3d cluster.
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'cluster-up.ps1')
if ($LASTEXITCODE -ne 0) { Stop-WithError 'cluster-up.ps1 failed (see above).' }

# 3. Warn (do not fail) if the hosts entries are missing; browsers still work, Node-based tools need them.
$hostsFile = "$env:WINDIR\System32\drivers\etc\hosts"
if (-not (Select-String -Path $hostsFile -Pattern '^\s*127\.0\.0\.1\s+.*\bstore\.localhost\b' -Quiet)) {
  Write-Host 'WARNING: store.localhost is not in the hosts file. Run: powershell -ExecutionPolicy Bypass -File scripts\setup-hosts.ps1' -ForegroundColor Yellow
}

# 4. Install the release if it does not exist yet (or when -Redeploy); otherwise just wait for the pods.
cmd /c "helm status urumi --namespace urumi-system >nul 2>&1"
$installed = ($LASTEXITCODE -eq 0)
if (-not $installed -or $Redeploy) {
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'deploy.ps1')
  if ($LASTEXITCODE -ne 0) { Stop-WithError 'deploy.ps1 failed (see above).' }
} else {
  Write-Host 'Release urumi already installed; waiting for the store to be ready (use -Redeploy to apply chart changes)...'
  kubectl -n store rollout status statefulset/mariadb --timeout=300s
  if ($LASTEXITCODE -ne 0) { Stop-WithError 'MariaDB did not become ready. See docs/troubleshooting.md.' }
  kubectl -n store rollout status deployment/wordpress --timeout=300s
  if ($LASTEXITCODE -ne 0) { Stop-WithError 'WordPress did not become ready. See docs/troubleshooting.md.' }
}

# 5. Compute the public store URL from the release's values (same rule as the chart's urumi.publicUrl).
$valuesJson = helm get values urumi --namespace urumi-system --all --output json
if ($LASTEXITCODE -ne 0) { Stop-WithError 'Could not read the release values.' }
$g = ($valuesJson | ConvertFrom-Json).global
$port = [int]$g.publicPort
$isDefaultPort = ($g.publicScheme -eq 'http' -and $port -eq 80) -or ($g.publicScheme -eq 'https' -and $port -eq 443)
$storeUrl = if ($isDefaultPort) { "$($g.publicScheme)://$($g.storeHost)" } else { "$($g.publicScheme)://$($g.storeHost):$port" }

Write-Host ''
Write-Host '================ Urumi platform is running ================' -ForegroundColor Green
Write-Host "  Storefront   : $storeUrl/"
Write-Host "  Shop         : $storeUrl/shop/"
Write-Host "  My account   : $storeUrl/my-account/   (customers: register, log in, see their orders)"
Write-Host "  WP admin     : $storeUrl/wp-admin/     (user: admin)"
Write-Host ''
Write-Host '  Admin password (copied to clipboard, not printed):'
Write-Host '    powershell -ExecutionPolicy Bypass -File scripts\get-admin-password.ps1'
Write-Host '  Stop everything (keeps data):'
Write-Host '    powershell -ExecutionPolicy Bypass -File scripts\stop.ps1'
Write-Host '  Full guide: docs/run-guide.md'
Write-Host '===========================================================' -ForegroundColor Green
if ($Open) { Start-Process "$storeUrl/" }
```

- [ ] **Step 2: Write `scripts/stop.ps1`**

```powershell
# Stops the local k3d cluster to free RAM. All data (volumes, Secrets) is kept.
# Start again with: powershell -ExecutionPolicy Bypass -File scripts\up.ps1
$ErrorActionPreference = 'Stop'
if (-not (Get-Command k3d -ErrorAction SilentlyContinue)) { Write-Host "ERROR: 'k3d' not found on PATH." -ForegroundColor Red; exit 1 }
k3d cluster stop urumi
if ($LASTEXITCODE -ne 0) { Write-Host 'ERROR: k3d cluster stop urumi failed (is Docker Desktop running?).' -ForegroundColor Red; exit 1 }
Write-Host 'Cluster urumi stopped. Data is kept. Start again with: powershell -ExecutionPolicy Bypass -File scripts\up.ps1'
```

- [ ] **Step 3: Write `scripts/get-admin-password.ps1`**

```powershell
# Copies the WordPress admin password to the clipboard. It is printed only with -Show.
#   powershell -ExecutionPolicy Bypass -File scripts\get-admin-password.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\get-admin-password.ps1 -Show
[CmdletBinding()]
param([switch]$Show)
$ErrorActionPreference = 'Stop'
$b64 = kubectl -n store get secret store-admin -o 'jsonpath={.data.password}'
if ($LASTEXITCODE -ne 0 -or -not $b64) { Write-Host 'ERROR: Secret store/store-admin not found. Is the store installed (scripts\up.ps1)?' -ForegroundColor Red; exit 1 }
$password = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b64))
Set-Clipboard -Value $password
if ($Show) { Write-Host "Admin password: $password" } else { Write-Host 'Admin password copied to the clipboard (user: admin). Use -Show to print it instead.' }
```

The admin user name is `admin` unless `storeSetup.adminUser` was overridden. If it was, the run guide says to read it from `helm get values urumi -n urumi-system --all`.

- [ ] **Step 4: Verify** (refresh PATH first). Then check each case:
  1. **Fast path:** `up.ps1` on the running cluster exits 0, prints the URL block with `http://store.localhost/…`, and contains no password. Grep the captured output for the actual password value: it must not appear. Do this without printing the password. Compare in memory.
  2. **Stop and start:** run `stop.ps1`, then `up.ps1`. Both exit 0. The store answers 200 at `/shop/`, and existing products and orders are still there. This exercises "data survives k3d cluster stop": record it as verified.
  3. **Redeploy:** `up.ps1 -Redeploy` exits 0, and `helm history` shows a new revision.
  4. **Password helper, default:** `get-admin-password.ps1` exits 0. The clipboard holds the password (check its length via `(Get-Clipboard).Length`, never print it), and the output has no password.
  5. **Password helper, `-Show`:** prints it. Don't paste the value into the report.
  6. **Docker not running:** this would stop Docker. Don't do that. Instead, simulate it by running the `docker info` probe line against a bogus context: `cmd /c "docker --context does-not-exist info >nul 2>&1"` exits non-zero. Reason from that that the branch triggers. (Optional; it's enough to say it was reviewed by reading.)

- [ ] **Step 5: Commit**

```bash
git add scripts/up.ps1 scripts/stop.ps1 scripts/get-admin-password.ps1
git commit -m "feat(scripts): add one-command start/stop and clipboard admin-password helper"
```

---

### Task 2: Customer accounts and "My Orders"

**Files:**
- Modify: `charts/urumi-platform/files/store-setup/setup.sh` (append options after the existing "configuring store options" block)
- Create: `scripts/dev/customer-order-smoke.ps1`

**Why:**
- WooCommerce shows a customer's orders (number, date, status, total, details) at `/my-account/orders/`, but only to a logged-in customer.
- Registration is off by default and orders were guest-only, so shoppers had no order history.
- There's no mail server in the cluster, so customers choose their own password instead of getting a generated one by email.

- [ ] **Step 1: Append to `setup.sh`**, after the `woocommerce_cod_settings` update:

```sh
log "enabling customer accounts (register on My Account and at checkout; customers choose their own password because no mail server is configured)"
$WP option update woocommerce_enable_myaccount_registration yes
$WP option update woocommerce_enable_signup_and_login_from_checkout yes
$WP option update woocommerce_enable_checkout_login_reminder yes
$WP option update woocommerce_registration_generate_username yes
$WP option update woocommerce_registration_generate_password no
```

**Check these option names against WooCommerce 11.2.1 before relying on them.**
- The WordPress container has PHP and `wp-load.php`, so you can query real settings without WP-CLI: `kubectl -n store exec deploy/wordpress -c wordpress -- php -r 'require "/var/www/html/wp-load.php"; foreach (["woocommerce_enable_myaccount_registration","woocommerce_enable_signup_and_login_from_checkout","woocommerce_enable_checkout_login_reminder","woocommerce_registration_generate_username","woocommerce_registration_generate_password","woocommerce_enable_delayed_account_creation"] as $o) { echo $o, "=", var_export(get_option($o, "(missing)"), true), PHP_EOL; }'`
- If WooCommerce 11.2.1's block checkout uses a different option for account creation (e.g. delayed account creation on the order-confirmation page), set that too. The goal is that a shopper can create an account at checkout or on My Account and then see their orders. Record which options were used and why.

- [ ] **Step 2: Deploy and verify the settings**
  - Run `powershell -ExecutionPolicy Bypass -File scripts\up.ps1 -Redeploy`. The setup log shows the new step and `SETUP COMPLETE`.
  - `curl.exe -s http://store.localhost/my-account/` contains the registration form (`woocommerce-form-register`), and a password field (`reg_password`), because generate_password is `no`.
  - The checkout page's block settings allow sign-up. Grep the checkout HTML for the relevant flag, e.g. `checkoutAllowsSignup`, and record the exact flag you found.

- [ ] **Step 3: Write `scripts/dev/customer-order-smoke.ps1`.** It's an end-to-end check that also creates realistic demo data. It uses PowerShell `Invoke-WebRequest` with a `WebSession` (cookies) against `http://store.localhost`:
  1. Register a new customer through the My Account form:
     - GET `/my-account/` and parse the `woocommerce-register-nonce` hidden field.
     - POST `email`, `password` (random, generated in-script and never printed), `woocommerce-register-nonce`, `_wp_http_referer=/my-account/` and `register=Register`.
     - Use the email `smoke+<yyyyMMddHHmmss>@example.com`.
  2. As that logged-in customer, place a COD order through the WooCommerce **Store API**:
     - GET `/wp-json/wc/store/v1/cart` and read the `Nonce` response header (send it back as the `Nonce` request header).
     - POST `/wp-json/wc/store/v1/cart/add-item` with `{ "id": <first product id>, "quantity": 1 }`. Get the product id from GET `/wp-json/wc/store/v1/products?per_page=1`.
     - POST `/wp-json/wc/store/v1/checkout` with `billing_address` (fixed demo values, the same email), `payment_method: "cod"`, and an empty `shipping_address` copy if required.
     - Record the returned order id.
  3. GET `/my-account/orders/`. It must contain that order number.
  4. Print the customer email, order id and the URL `/my-account/orders/`. **Never print the password.** If the user wants to log in as that customer, they register their own account instead. Say so in the output.
  5. Exit 0 only if all steps succeed; on failure, give a clear message and exit 1.

  It's acceptable (documented) that the script leaves a demo customer and order in the store. They're useful demo data for "orders today".

- [ ] **Step 4: Run the smoke script.** It must pass. Then confirm the order is visible in wp-admin data: `kubectl … php -r` with `wc_get_order(<id>)->get_customer_id()` must be non-zero.

  If the Store API flow differs in 11.2.1 (nonce header name, required fields), adapt the script and record it. If registration is impossible with these settings, report DONE_WITH_CONCERNS with evidence.

- [ ] **Step 5: Commit**

```bash
git add charts/urumi-platform/files/store-setup/setup.sh
git commit -m "feat(store): enable customer accounts so shoppers can see their order history"
git add scripts/dev/customer-order-smoke.ps1
git commit -m "test(scripts): add end-to-end customer registration and COD order smoke test"
```

---

### Task 3: Central run guide and doc updates

**Files:**
- Create: `docs/run-guide.md`
- Modify:
  - `README.md` (Quick start uses `up.ps1`; link to the run guide)
  - `docs/README.md` (map row)
  - `docs/deployment.md` (mention `up.ps1`/`stop.ps1`; the k3d-stop data claim becomes verified if Task 1 proved it)
  - `docs/workflows.md` (add a "Customer account and order history" workflow with a Mermaid diagram and failure notes; mark it verified by the smoke script)
  - `docs/troubleshooting.md` (entries for up.ps1 messages; "Docker Desktop's Kubernetes tab shows no cluster")
  - `docs/learning/00-setup-log.md` (data survives stop: verified)
  - `scripts/cluster-down.ps1` comment (verified wording)

**`docs/run-guide.md`** is THE beginner document for running every part of the project. Later phases append to it. Required sections, in order:

1. **What runs where:** Windows → Docker Desktop → k3d containers → Kubernetes pods. A small diagram.
   - **Why Docker Desktop shows only 3 containers** (`k3d-urumi-server-0` = the Kubernetes node, `k3d-urumi-serverlb` = the port-80/443 load balancer, `k3d-urumi-tools` = a k3d helper). The pods (WordPress, MariaDB…) run *inside* `k3d-urumi-server-0` under its own container runtime (containerd), so Docker Desktop doesn't list them.
   - **Why Docker Desktop's "Kubernetes" tab shows no cluster:** it only manages Docker Desktop's *own* built-in Kubernetes, and we use k3d instead (ADR-002).
   - **How to see pods:** `kubectl get pods -A`. Optional GUIs:
     - Headlamp (`winget install --id Headlamp.Headlamp -e`) reads `~/.kube/config` and shows the `k3d-urumi` cluster.
     - The VS Code "Kubernetes" extension.
     - Mark these optional and not required.
2. **Prerequisites and one-time setup:**
   - Docker Desktop, the `.wslconfig` cap, `winget install` Helm and k3d.
   - `setup-hosts.ps1`.
   - The first `up.ps1`, which takes about 2–3 minutes and downloads images and WooCommerce.
   - Link to `docs/learning/00-setup-log.md`.
3. **Daily use:**
   - Start: `up.ps1` (show sample output with the URL block, without a password). `-Open` and `-Redeploy`.
   - Stop: `stop.ps1`.
   - After a laptop restart: start Docker Desktop, then `up.ps1`.
4. **URLs table:** storefront, shop, cart, checkout, my-account, my-account/orders, wp-admin. Later: dashboard, gateway `/mcp` **(planned — Phase 3/4)**.
5. **Passwords and secrets:**
   - `get-admin-password.ps1` (clipboard; `-Show`).
   - Why passwords are never printed by scripts.
   - Where every secret lives (table: Secret name, namespace, keys, used by).
   - A rule: never paste them into chats or commits.
6. **Using the store:**
   - Shopper flow: browse, cart, checkout with COD, order received.
   - Customer account: register on My Account or at checkout, then My Account → Orders (date, status, total, details). Note: WooCommerce links earlier **guest** orders placed with the same email to the new account (verify this claim in Task 3. If it can't be verified, label it expected).
   - Admin: WooCommerce → Orders (all orders, change status), Products (add/edit/delete).
   - **Adding staff users:** Users → Add New User → Role **Shop manager**, with a role table (Administrator / Shop manager / Customer).
7. **Viewing the store database (MariaDB):**
   - (a) Quick SQL in the terminal. This is a `kubectl exec` one-liner that reads the password from the Secret into a variable without echoing it, then opens the `mariadb` client. Give 4 useful example queries (products, orders, order items, users) matching the real tables: orders are `wp_posts` with `post_type='shop_order'`, because HPOS is off (`woocommerce_custom_orders_table_enabled = no`); also `wp_woocommerce_order_items` and `wp_wc_order_stats`.
   - (b) GUI: `kubectl -n store port-forward svc/mariadb 3307:3306` in one terminal. Then HeidiSQL (`winget install --id HeidiSQL.HeidiSQL -e`) or DBeaver (`winget install --id DBeaver.DBeaver.Community -e`): host `127.0.0.1`, port `3307`, user `root` (password: a command that copies `store-db` `root-password` to the clipboard), database `wordpress`.
   - A table explaining which data lives in which tables.
   - A warning: read-only browsing is fine, but never edit WooCommerce tables by hand. Use wp-admin; WooCommerce owns its business rules.
8. **The gateway database (Postgres)** **(planned — Phase 3):** a placeholder that explains it will hold gateway users, hashed API keys, MCP server registry and the audit log. It's separate from MariaDB on purpose (ownership, security, independence). Exact steps arrive in Phase 3.
9. **Each part of the project:** a table of Store (Phase 1, available), WooCommerce MCP server (planned P2), Gateway + Postgres (P3), Dashboard + chat (P4), with how to run, check and see logs for each. Only the store rows have real commands for now.
10. **Health checks and logs:** `kubectl -n store get pods`, `kubectl -n store logs deploy/wordpress -c wordpress`, `kubectl -n store logs job/store-setup`, `scripts\check-woo-api.ps1`, `scripts\dev\customer-order-smoke.ps1`.
11. **Resetting:**
    - Uninstall keeping data: `helm uninstall`.
    - Wipe all store data: `kubectl delete ns store mcp gateway`. **Destroys data.**
    - Delete the cluster: `cluster-down.ps1`. **Destroys everything.**
12. **Troubleshooting pointers:** links to `docs/troubleshooting.md` entries.

**Rules for this task:**
- Every command must be PowerShell 5.1-correct and quoted for the repo path.
- Every claim must be either verified (say so) or labelled expected.
- Never print a real secret in the docs.
- Run a relative-link check over docs/ and README.md (0 broken).

- [ ] **Step 1:** Write `docs/run-guide.md`.
- [ ] **Step 2:** Apply the modifications listed under Files.
- [ ] **Step 3:** Run the link check.
- [ ] **Step 4: Commit**

```bash
git add docs/run-guide.md
git commit -m "docs: add central run guide for starting, using and inspecting the platform"
git add README.md docs scripts/cluster-down.ps1
git commit -m "docs: point README and docs at the run guide and document customer accounts"
```

## Self-review
- Covers everything the user asked for:
  - one command with URLs ✔ (Task 1)
  - no passwords in output ✔ (Task 1 + constraint)
  - a command for the admin password, documented ✔ (Task 1 + Task 3 §5)
  - customer order history ✔ (Task 2)
  - adding staff users ✔ (Task 3 §6)
  - viewing MariaDB without commands ✔ (Task 3 §7b)
  - Postgres placeholder ✔ (§8)
  - Docker Desktop "no cluster" explanation ✔ (§1)
  - a run guide for every part, extended per phase ✔ (Task 3)
- The interfaces `up.ps1 -Redeploy/-Open`, `stop.ps1` and `get-admin-password.ps1 -Show` are used identically in Tasks 1 and 3.
