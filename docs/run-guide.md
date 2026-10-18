# Run guide

How to run, use and inspect every part of the project, written for someone new to Kubernetes. Every phase extends this guide. Parts that are not built yet are marked **(planned — Phase N)** and contain no commands.

Statements are either **verified** (run on the reference machine, with the date) or labelled **expected**.

> **Quick start (TL;DR)**
>
> 1. Start **Docker Desktop** and wait until it says "Engine running".
> 2. In PowerShell, from the repository root: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\up.ps1`
> 3. Click the URLs it prints (storefront, shop, my account, wp-admin).
> 4. Need the admin password? `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\get-admin-password.ps1` copies it to your clipboard (user `admin`).
> 5. Done for the day: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\stop.ps1` (keeps your data).

All commands are run from the repository root in **Windows PowerShell 5.1**. The folder path contains spaces on the reference machine; the scripts quote their own paths, so just `cd` into the folder first.

## Contents

1. [What runs where](#1-what-runs-where)
2. [Prerequisites and one-time setup](#2-prerequisites-and-one-time-setup)
3. [Daily use](#3-daily-use)
4. [URLs](#4-urls)
5. [Passwords and secrets](#5-passwords-and-secrets)
6. [Using the store](#6-using-the-store)
7. [Viewing the store database (MariaDB)](#7-viewing-the-store-database-mariadb)
8. [The gateway database (Postgres)](#8-the-gateway-database-postgres-planned--phase-3)
9. [Each part of the project](#9-each-part-of-the-project)
10. [Health checks and logs](#10-health-checks-and-logs)
11. [Resetting](#11-resetting)
12. [Troubleshooting pointers](#12-troubleshooting-pointers)

---

## 1. What runs where

```mermaid
flowchart TB
    W["Windows 11 (your laptop)<br/>PowerShell, browser, kubectl, helm"]
    D["Docker Desktop (WSL2)"]
    subgraph K3D["k3d cluster 'urumi' (3 Docker containers)"]
        LB["k3d-urumi-serverlb<br/>ports 80 and 443 load balancer"]
        TOOLS["k3d-urumi-tools<br/>k3d helper"]
        subgraph NODE["k3d-urumi-server-0 = the Kubernetes node (k3s, containerd inside)"]
            P1["pod wordpress"]
            P2["pod mariadb-0"]
            P3["pod store-setup (Job, finished)"]
            P4["Traefik, CoreDNS, ... (kube-system)"]
        end
    end
    W --> D --> K3D
    LB --> P4 --> P1 --> P2
```

Reading it from the outside in: your browser talks to port 80 on Windows. Docker Desktop forwards that to the `k3d-urumi-serverlb` container, which hands it to Traefik (the ingress controller) inside the node, which routes `store.localhost` to the WordPress pod. WordPress stores everything in MariaDB.

**Why Docker Desktop shows only 3 containers (verified 2026-10-18).** They are:

| Container | What it is |
|---|---|
| `k3d-urumi-server-0` | The Kubernetes node itself (k3s). |
| `k3d-urumi-serverlb` | The load balancer that publishes ports 80 and 443. |
| `k3d-urumi-tools` | A helper container used by k3d. |

The pods (WordPress, MariaDB and so on) run **inside** `k3d-urumi-server-0`, under that container's own container runtime (containerd). Docker Desktop only sees the outer containers, so it never lists the pods.

**Why Docker Desktop's "Kubernetes" tab shows no cluster.** That tab manages only Docker Desktop's own built-in Kubernetes. This project uses **k3d** instead (see [ADR-002](decisions/ADR-002-k3d-k3s-traefik.md)), so the tab stays empty and that is normal. Do not enable Docker Desktop's Kubernetes for this project.

**How to see the pods.**

```powershell
kubectl get pods -A          # every pod in every namespace
kubectl -n store get pods    # only the store
```

Optional graphical tools (not required; **not tested on the reference machine**):

- **Headlamp**, a Kubernetes GUI: `winget install --id Headlamp.Headlamp -e`. It reads `~/.kube/config`, where the `k3d-urumi` context lives.
- The **Kubernetes** extension for VS Code, which also reads `~/.kube/config`.

## 2. Prerequisites and one-time setup

| Step | What | Notes |
|---|---|---|
| 1 | Windows 11, PowerShell 5.1 | Check: `$PSVersionTable.PSVersion` |
| 2 | **Docker Desktop** (WSL2 backend) | Must be **running** whenever you use the project. |
| 3 | Memory cap in `C:\Users\<you>\.wslconfig` | On the reference machine (15 GB RAM) the file sets `memory=9GB`, `processors=8`, `swap=4GB`. Without a cap WSL2 may take half the RAM. After editing run `wsl --shutdown` and restart Docker Desktop. |
| 4 | `winget install --id Helm.Helm -e` and `winget install --id k3d.k3d -e` | Then open a **new** terminal so PATH refreshes. `kubectl` ships with Docker Desktop. |
| 5 | Hosts entries (optional) | `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\setup-hosts.ps1` (UAC prompt, safe to repeat). Browsers do not need it; Node-based MCP tools do. |
| 6 | The first `up.ps1` | Creates the cluster, downloads images and WooCommerce, installs the store. **Expected: about 2–3 minutes** the first time. |

Versions used, and how each tool was installed, are in [learning/00-setup-log.md](learning/00-setup-log.md). The long-form deployment steps are in [deployment.md](deployment.md).

## 3. Daily use

### Start

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\up.ps1
```

`up.ps1` checks that `docker`, `k3d`, `kubectl` and `helm` exist and that Docker is running, starts (or creates) the cluster, warns if the hosts entry is missing, installs the store **only if it is not installed yet**, waits until the store is ready, and prints a URL block. It never prints passwords. The ending looks like this:

```text
================ Urumi platform is running ================
  Storefront   : http://store.localhost/
  Shop         : http://store.localhost/shop/
  My account   : http://store.localhost/my-account/   (customers: register, log in, see their orders)
  WP admin     : http://store.localhost/wp-admin/     (user: admin)

  Admin password (copied to clipboard, not printed):
    powershell -ExecutionPolicy Bypass -File scripts\get-admin-password.ps1
  Stop everything (keeps data):
    powershell -ExecutionPolicy Bypass -File scripts\stop.ps1
  Full guide: docs/run-guide.md
===========================================================
```

Options:

| Option | Effect |
|---|---|
| `-Open` | Also opens the storefront in your browser. |
| `-Redeploy` | Also runs `helm upgrade` so chart or value changes take effect (a plain `up.ps1` does not touch an installed release). |

### Stop

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\stop.ps1
```

This runs `k3d cluster stop urumi`, which frees the RAM. **Data survives a stop and the next `up.ps1` — verified (2026-10-18):** the products and two orders were still present afterwards.

### After a laptop restart

Start Docker Desktop, wait for "Engine running", then run `up.ps1` again. The cluster is stopped after a reboot; `up.ps1` starts it and keeps your data.

## 4. URLs

With the default settings (host port 80, **verified**):

| What | URL | Notes |
|---|---|---|
| Storefront | <http://store.localhost/> | |
| Shop | <http://store.localhost/shop/> | Product list |
| Cart | <http://store.localhost/cart/> | |
| Checkout | <http://store.localhost/checkout/> | Redirects to the cart when the cart is empty (normal) |
| My account | <http://store.localhost/my-account/> | Customers register and log in here |
| My orders | <http://store.localhost/my-account/orders/> | A logged-in customer's order history |
| WordPress admin | <http://store.localhost/wp-admin/> | User `admin`, password: see [section 5](#5-passwords-and-secrets) |
| Dashboard | **(planned — Phase 4)** | Not built yet |
| Gateway `/mcp` endpoint | **(planned — Phase 3/4)** | Not built yet |

If you moved the store to port 8081 (see [deployment.md](deployment.md)), add `:8081` to every URL; `up.ps1` prints the right ones.

## 5. Passwords and secrets

**Admin password.** The password is generated on first install and lives only in a Kubernetes Secret. To get it:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\get-admin-password.ps1          # copies to the clipboard (user: admin)
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\get-admin-password.ps1 -Show    # prints it instead
```

**Why scripts never print passwords.** Console output ends up in scrollback, screenshots, shared terminals and chat logs. The scripts print the *command that retrieves* a secret instead. The only exception is the `-Show` switch, which you type on purpose.

**Where every secret lives** (namespace `store`; values are never shown in this guide):

| Secret | Keys | Used by |
|---|---|---|
| `store-admin` | `password` | The WordPress `admin` login; created at install and read by `get-admin-password.ps1`. |
| `store-db` | `root-password`, `password` | MariaDB. `password` is for the app user `wordpress`, which WordPress uses; `root-password` is for the MariaDB `root` user, used by you for inspection (section 7) and by the store-setup Job. |
| `store-woo-api` | `consumer-key`, `consumer-secret` | The WooCommerce REST/OAuth1 key created at install for the later MCP server; used by `check-woo-api.ps1`. The key is stored hashed in the `wp_woocommerce_api_keys` table. |

**Rule: never paste a secret into a chat, an issue or a commit.** Secrets are generated per install, so they are not in Git.

## 6. Using the store

### As a shopper

1. Open the storefront or `/shop/` and click a product, then **Add to cart**.
2. Open the cart and go to checkout.
3. Fill in the billing details and choose **Cash on delivery** (the only payment method; shipping is disabled).
4. **Place order**. The "Order received" page confirms it.

### As a customer with an account

Customer accounts are enabled (**verified 2026-10-18** by `scripts\dev\customer-order-smoke.ps1`).

- Register at <http://store.localhost/my-account/> or tick "Create an account" at checkout. The username is generated for you, and you choose your own **password**, because there is no mail server to send a generated one.
- After logging in, **My Account → Orders** lists your orders with date, status and total; **View** opens the details.
- **Guest orders are NOT linked to a later account.** In WooCommerce 11.2.1 an order placed as a guest stays a guest order, even if you later register with the same email. It will not show in My Account → Orders (**verified 2026-10-18**: a guest order stayed `customer_id 0` and was absent from My Orders). Guest orders are visible only to the admin, in WooCommerce → Orders. To see an order under My Account, log in **before** you check out.

The full flow is in [workflows.md](workflows.md#5-customer-account-and-order-history).

### As the admin

Log in at <http://store.localhost/wp-admin/> as `admin`.

- **WooCommerce → Orders:** all orders, including guest orders. Open an order to change its status.
- **Products → All Products / Add New:** add, edit or delete products.

### Adding staff users

**Users → Add New User**, fill in username, email and a password, and set **Role** to **Shop manager** to give someone store access without full site control. Then press **Add New User**.

| Role | What it can do |
|---|---|
| Administrator | Everything: settings, plugins, users, themes, orders, products. |
| Shop manager | Manage products, orders and customers, and see WooCommerce reports. Cannot change site-wide WordPress settings or install plugins. |
| Customer | Buy and view their own orders in My Account. No access to wp-admin. This is the default for registered shoppers. |

The role descriptions follow standard WooCommerce behavior (expected; the Shop manager role was not exercised here).

## 7. Viewing the store database (MariaDB)

The store keeps everything in MariaDB: database `wordpress` (48 tables, verified 2026-10-18) in namespace `store`, pod `mariadb-0`.

**Read-only browsing is fine. Never edit WooCommerce tables by hand.** WooCommerce enforces its own business rules (stock, order totals, status changes, caches); a manual `UPDATE` can leave the store inconsistent. Use wp-admin for changes.

### (a) Quick SQL in the terminal

This reads the root password from the Secret into a variable **without printing it**, then opens the `mariadb` client inside the pod:

```powershell
$pw = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String((kubectl -n store get secret store-db -o 'jsonpath={.data.root-password}')))
kubectl -n store exec -it mariadb-0 -- mariadb -uroot "-p$pw" wordpress
```

Type `exit` to leave. Note: the password is passed as a command argument *inside the pod*, so it is briefly visible in that pod's process list. That is acceptable for a local cluster; do not copy this habit to a shared server.

Four useful queries (run inside the client, or one at a time with `-e "<sql>"`). They were run against the live database on 2026-10-18 (read-only) and worked:

```sql
-- 1. Products
SELECT ID, post_title, post_status FROM wp_posts WHERE post_type='product' AND post_status IN ('publish','draft') ORDER BY ID;

-- 2. Orders (HPOS is off, so orders are wp_posts rows; total and customer come from wp_postmeta)
SELECT p.ID AS order_id, p.post_status, p.post_date, m.meta_value AS total, c.meta_value AS customer_user
FROM wp_posts p
JOIN wp_postmeta m ON m.post_id=p.ID AND m.meta_key='_order_total'
JOIN wp_postmeta c ON c.post_id=p.ID AND c.meta_key='_customer_user'
WHERE p.post_type='shop_order' ORDER BY p.ID DESC LIMIT 10;

-- 3. Order line items (what was bought in each order)
SELECT order_id, order_item_name, order_item_type FROM wp_woocommerce_order_items ORDER BY order_id DESC LIMIT 10;

-- 4. Users
SELECT ID, user_login, user_email, user_registered FROM wp_users ORDER BY ID;
```

What they showed (columns and sample rows, no secrets):

- Query 1: columns `ID, post_title, post_status`; rows such as `10 Urumi Coffee Mug publish`.
- Query 2: columns `order_id, post_status, post_date, total, customer_user`; rows such as `19 wc-processing ... 3.00 0` (a guest order, customer_user `0`) and `18 wc-processing ... 3.00 2` (customer 2).
- Query 3: columns `order_id, order_item_name, order_item_type`; rows such as `19 Urumi Testing shirt line_item`.
- Query 4: columns `ID, user_login, user_email, user_registered`; the `admin` user is ID 1.

Why orders come from `wp_postmeta` here and not `wp_wc_order_stats`: that analytics table is filled by a background job and **lagged behind** (**observed 2026-10-18**: it held orders 14 and 15 while 18 and 19 were not in it yet), so `wp_postmeta` is the reliable source.

### (b) A graphical SQL client (optional; not tested on the reference machine)

Terminal 1 (leave it running; it forwards local port 3307 to MariaDB):

```powershell
kubectl -n store port-forward svc/mariadb 3307:3306
```

Install a client, either one:

```powershell
winget install --id HeidiSQL.HeidiSQL -e
winget install --id DBeaver.DBeaver.Community -e
```

Create a connection with these standard MySQL/MariaDB settings:

| Field | Value |
|---|---|
| Host | `127.0.0.1` |
| Port | `3307` |
| User | `root` |
| Password | copied to your clipboard by the command below, then paste it |
| Database | `wordpress` |

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\get-db-password.ps1          # copies the root password to the clipboard
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\get-db-password.ps1 -Show    # prints it instead
```

Press Ctrl+C in terminal 1 to close the tunnel when you are done.

### Which data lives in which tables

HPOS ("high-performance order storage") is **off** (`woocommerce_custom_orders_table_enabled = no`), so orders use the classic WordPress layout.

| Data | Tables |
|---|---|
| Products | `wp_posts` (`post_type='product'`), `wp_postmeta` (price, stock), `wp_wc_product_meta_lookup` (fast price/stock lookup) |
| Orders | `wp_posts` (`post_type='shop_order'`, status like `wc-processing`), `wp_postmeta` (total, customer, billing) |
| Order line items | `wp_woocommerce_order_items` (+ `wp_woocommerce_order_itemmeta`) |
| Order analytics | `wp_wc_order_stats` (date, status, total; filled by a background job, can lag) |
| Users and customers | `wp_users`, `wp_usermeta` (role, name) |
| Settings | `wp_options` |
| MCP/REST API key | `wp_woocommerce_api_keys` (the consumer key is stored hashed) |

## 8. The gateway database (Postgres) (planned — Phase 3)

Not built yet; there are no commands to run. The gateway will have its **own** Postgres database holding gateway users, hashed API keys, the MCP-server registry and the audit log. It is separate from MariaDB on purpose:

- **Ownership:** MariaDB belongs to WooCommerce, which owns its schema and upgrades. The gateway's data must not live in, or depend on, another application's tables.
- **Security:** gateway API-key hashes and the audit log are more sensitive than shop data; a separate database means separate credentials and a smaller blast radius if the store is compromised.
- **Independence:** each side can be upgraded, backed up, restored or replaced without touching the other.
- **Failure isolation:** a broken or overloaded store database does not take the gateway down, and the other way around.

Exact steps arrive in Phase 3.

## 9. Each part of the project

| Part | Status | How to run | How to check | Logs |
|---|---|---|---|---|
| **Store** (WordPress + WooCommerce + MariaDB) | Available (Phase 1) | `scripts\up.ps1`; stop with `scripts\stop.ps1` | `kubectl -n store get pods`; `scripts\check-woo-api.ps1`; `scripts\dev\customer-order-smoke.ps1` | `kubectl -n store logs deploy/wordpress -c wordpress`; `kubectl -n store logs mariadb-0`; `kubectl -n store logs job/store-setup` |
| **WooCommerce MCP server** | (planned — Phase 2) | — | — | — |
| **Gateway + Postgres** | (planned — Phase 3) | — | — | — |
| **Dashboard + chat agent** | (planned — Phase 4) | — | — | — |

## 10. Health checks and logs

```powershell
kubectl -n store get pods                                    # wordpress and mariadb-0 should be 1/1 Running; store-setup is Completed
kubectl -n store logs deploy/wordpress -c wordpress          # Apache access log and PHP errors
kubectl -n store logs job/store-setup                        # install log; the last line is SETUP COMPLETE
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check-woo-api.ps1                       # WooCommerce REST key check
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dev\customer-order-smoke.ps1            # register, order, see it in My Account
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dev\customer-order-smoke.ps1 -CheckGuestLinking   # also checks guest-order linking
```

The smoke test leaves a demo customer and order in the store (users like `smoke+<timestamp>@example.com`). It never prints the password it generates.

## 11. Resetting

| Goal | Command | Effect |
|---|---|---|
| Remove the store but keep the data | `helm uninstall urumi --namespace urumi-system` | The data volumes and namespace are kept; a later `up.ps1` reinstalls and the data comes back (verified, see [deployment.md](deployment.md#step-9-uninstall-and-what-is-kept)). |
| Wipe all store data | `kubectl delete ns store mcp gateway` | **Destroys data**: products, orders, users and passwords. The next install makes a brand-new store. |
| Delete the whole cluster | `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\cluster-down.ps1` | **Destroys everything**, including all data. `up.ps1` recreates it from scratch. |

## 12. Troubleshooting pointers

- `up.ps1` says Docker is not running: [troubleshooting](troubleshooting.md#upps1-says-docker-is-not-running)
- `up.ps1` warns that `store.localhost` is not in the hosts file: [troubleshooting](troubleshooting.md#upps1-warns-that-storelocalhost-is-not-in-the-hosts-file)
- Docker Desktop's Kubernetes tab shows no cluster: [troubleshooting](troubleshooting.md#docker-desktops-kubernetes-tab-shows-no-cluster)
- A guest order is missing from My Account: [troubleshooting](troubleshooting.md#i-cannot-see-my-guest-order-in-my-account)
- `customer-order-smoke.ps1` fails: [troubleshooting](troubleshooting.md#customer-order-smokeps1-fails)
- Port 80 in use, pods not ready, setup Job failed and the rest: the full list at the top of [troubleshooting.md](troubleshooting.md).
