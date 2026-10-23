# ADR-018: WordPress scheduled work runs from a CronJob, not from loopback requests

## Status

Accepted. **Implemented in the Phase 5 final review** (2026-10-23).

## Date

2026-10-23

## Context

WordPress runs its scheduled work (WP-Cron events) from page loads: each request may fire `wp_remote_post(site_url('wp-cron.php'))`, a request to the store's own **public URL**. WooCommerce's Action Scheduler is driven the same way. It releases stock held by unpaid orders, runs scheduled sales and webhooks, and imports analytics.

The default-deny NetworkPolicies ([ADR-016](ADR-016-default-deny-network-policies.md)) let WordPress reach the internet only outside the private ranges. On a k3s VPS the public host name resolves to the node, and ServiceLB/kube-proxy translates the connection to the Traefik **pod** IP (`10.42.x.x`). The rule's `except: 10.0.0.0/8` then drops it (expected from the rules; not tested on a VPS). Scheduled work would silently stop while the store looks healthy.

## Decision

- **`wordpress.cron.enabled`** (default `true`) does two things.
  - It sets `define('DISABLE_WP_CRON', true);` in `WORDPRESS_CONFIG_EXTRA`, so page loads never call `wp-cron.php`.
  - It renders the CronJob **`wp-cron`** in `store`: `wp --path=/var/www/html cron event run --due-now` with the store-setup WP-CLI image, every 5 minutes (`wordpress.cron.schedule`).
- **CronJob settings:**
  - `concurrencyPolicy: Forbid`, `startingDeadlineSeconds: 120`, `backoffLimit: 0`, `activeDeadlineSeconds: 240`, history 1 successful and 3 failed.
  - The pod runs as uid/gid 33 (`restricted`) with the WordPress PVC and a 64Mi `/tmp`, and gets the same database settings and `WORDPRESS_CONFIG_EXTRA` as WordPress.
  - It first waits for the database (at most 30 x 2 s). A new pod can connect before kube-router has admitted its IP to MariaDB's policy, and the first runs failed in under a second without this wait (observed 2026-10-23).
- **NetworkPolicy `wp-cron`:** egress to MariaDB 3306 and the internet rule (scheduled events may call external APIs); no ingress. MariaDB admits wp-cron.
- With `wordpress.cron.enabled: false` neither the constant nor the CronJob is rendered, and WordPress falls back to its built-in WP-Cron, which works only where the loopback works.

## Alternatives considered

- **(a) An egress rule from WordPress to the Traefik pods** (`kube-system`, Traefik's container ports 8000/8443). Rejected. It still depends on how each provider routes a pod's request to its own public IP (hairpin NAT), which differs between VPS providers and was not testable here. It also opens an in-cluster path from WordPress to the ingress controller.
- **Do nothing and document the risk.** Rejected: stock held by unpaid orders would never be released, and nobody would get a signal.
- **A sidecar loop in the WordPress pod.** Rejected: it ties the schedule to the web pod's lifecycle and resources, and a CronJob is the standard Kubernetes shape for this.

## Consequences/trade-offs

- **Verified on the local cluster, 2026-10-23:**
  - `DISABLE_WP_CRON` evaluates to `true` in the WordPress pod.
  - A manual Job (`kubectl -n store create job --from=cronjob/wp-cron`) completed in 7 s and logged `Executed the cron event 'action_scheduler_run_queue'` with no error.
  - The overdue WP-Cron event count, read in a throw-away WP-CLI pod, went from 1 to 0 across that run.
  - Before the database wait, 3 of the first 4 scheduled runs failed that way. After it, the next three scheduled runs (06:20, 06:25 and 06:30 UTC) completed.
  - An order placed by `customer-order-smoke.ps1` left 2 past-due Action Scheduler actions; after the next scheduled run there were 0.
  - The check scripts and `smoke-test.ps1` passed.
- **Expected; not tested on a VPS:** the same behaviour on a real server.
- Scheduled work runs at most every 5 minutes instead of on the next page load, so a scheduled sale may start up to 5 minutes late. A held-stock timeout (60 minutes by default) is not materially affected.
- wp-admin's Site Health "loopback request" test still fails on a VPS (expected). It is cosmetic, because nothing depends on the loopback any more.
- Each run is a short-lived pod every 5 minutes (5 to 7 s observed, including the database check; requests 50m CPU / 128Mi).

## Revisit if

- The store runs more than one WordPress replica on different nodes. The `ReadWriteOnce` volume pins the CronJob to WordPress's node through pod affinity.
- Scheduled work needs to run more often than every 5 minutes, or takes longer than 4 minutes.
