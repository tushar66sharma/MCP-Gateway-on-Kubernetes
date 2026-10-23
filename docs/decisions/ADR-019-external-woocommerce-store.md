# ADR-019: A WooCommerce store hosted elsewhere, reached with HTTP Basic over HTTPS

## Status

Accepted. **Implemented in Phase 5b (Task 5b.5).** The MCP server mode is verified live; the chart's external mode is **rendered, not installed** (see Consequences).

## Date

2026-10-23

## Context

Until now the WooCommerce MCP server talked only to the WordPress that this chart installs, in the same cluster, over plain HTTP, signing each request with OAuth 1.0a ([ADR-005](ADR-005-woocommerce-rest-oauth1.md)). WooCommerce requires OAuth 1.0a on plain HTTP because Basic would send the key and secret in clear text. A store hosted elsewhere (a managed WooCommerce host, another cluster) is reached over HTTPS, where WooCommerce accepts HTTP Basic auth with the consumer key as user name and the consumer secret as password. Signing against such a store is also fragile: OAuth 1.0a signs the exact URL, and a proxy or CDN that rewrites it breaks the signature.

Two things must not change: with the default values the in-cluster store works exactly as before, and a credential must never travel over a channel that does not protect it or appear in a URL, a log or an error text.

## Decision

- **MCP server (`apps/mcp-woocommerce`).** `WOO_AUTH_MODE` is `oauth1` (default) or `basic`.
  - `oauth1`: unchanged. `WOO_SIGNING_BASE_URL` is required and must start with `http://`.
  - `basic`: `WOO_BASE_URL` must start with `https://`; `WOO_SIGNING_BASE_URL` is optional and ignored. The client sends `Authorization: Basic base64(key:secret)` and no `oauth_*` parameters. Redirects are still not followed, so the header is never forwarded to another host.
  - In every mode a `WOO_BASE_URL` with user info (`user:pass@`) is refused. Start-up errors name the variable only.
  - The client removes the key, the secret and the base64 form of `key:secret` from any error text.
- **Chart.** `store.enabled` (default `true`) and `mcpWoocommerce.externalStore` (`url`, `existingSecret`, `extraEgressCIDRs`).
  - With `externalStore.url` set, `mcp-woocommerce` gets `WOO_BASE_URL` = that URL, `WOO_AUTH_MODE=basic`, and the key and secret from `externalStore.existingSecret` (keys `consumer-key` and `consumer-secret`, namespace `mcp`). The chart never generates or copies that Secret. The template fails when the Secret name is empty.
  - The pod's egress policy is the shared internet rule (443 and 80, private and special-use ranges excluded) plus one `ipBlock` per `extraEgressCIDRs` entry on 443, instead of the in-cluster WordPress rule. A store on a private network is therefore reached only through an explicit CIDR.
  - With `store.enabled: false` the chart renders nothing for the store: no WordPress, MariaDB, setup Job, wp-cron CronJob, Ingress, Secrets, store NetworkPolicies, HSTS/redirect Middlewares, solver policy, and no `store` namespace. The schema then requires `externalStore.url` while `mcpWoocommerce.enabled` is true.
- **The https-only rule is enforced twice**: in the MCP server config and in the chart (schema pattern `^https://[^/@\s]+(/.*)?$` plus a template check). A value that would send credentials in clear text or inside a URL is refused before anything is deployed.

## Alternatives considered

- **Keep OAuth 1.0a for external stores.** It works over HTTP, which is exactly the case we do not want to support for a remote store, and signing breaks behind rewriting proxies. Rejected.
- **Allow Basic over HTTP for trusted networks.** Sends the secret in clear text; one wrong value would leak it. Rejected: https only, no override.
- **Application Passwords or JWT instead of WooCommerce REST keys.** They authenticate a WordPress user, not a REST key with Read/Write scope, and need plugins or a different permission model. Not needed for this goal.
- **Have the chart create the Secret from values.** Would put a credential in a values file and in Helm's release Secret. Rejected: the operator creates the Secret and the chart only references it.
- **Skip the store in the chart with a separate chart.** Two charts to keep in step with the shared namespaces, policies and helpers. A switch in the one chart keeps the default render identical ([ADR-003](ADR-003-single-helm-chart-three-namespaces.md)).

## Consequences/trade-offs

- **Verified (2026-10-23).**
  - Unit tests cover the config rules, the Basic header, absence of `oauth_*` parameters and credential redaction.
  - The built server was run on the host against the local WooCommerce 11.2.1 over HTTPS through Traefik, with a throw-away CA and **TLS verification on**. `list_products` returned the store's products, `create_product` created a draft, and `update_order_status` worked. The same run without the CA failed with a certificate error (`UNABLE_TO_VERIFY_LEAF_SIGNATURE` for a plain fetch). WordPress treated the Traefik-forwarded request as HTTPS (Phase 5 sets `HTTPS=on` from `X-Forwarded-Proto`), so no workaround was needed.
  - `scripts\validate-chart.ps1` proves that, with the default values, every rendered object equals `main`'s render (secret data and the Phase 5b gateway variables excluded), and checks the external-mode render and the rejections.
- **Rendered, not installed.** The chart's external mode was rendered with `helm template` and linted. It was not installed on a cluster; the local cluster keeps the in-cluster store. Reaching a real remote host, the egress rule against a real remote address, and a host that strips the `Authorization` header are **not tested**.
- **Time zone.** `STORE_TIMEZONE` still comes from `storeSetup.timezone`; for an external store it must match the store's own zone or `today` and `yesterday` are computed for the wrong day.
- **Rotation.** The pod reads the Secret at start. After rotating the key, restart it: `kubectl -n mcp rollout restart deploy/mcp-woocommerce`.
- **Local helper scripts** (`up.ps1`, `check-mcp-woocommerce.ps1` and others) assume the in-cluster store and are not adapted to `store.enabled: false`.

## Revisit if

- A target host rejects Basic over HTTPS (for example it strips the `Authorization` header and cannot be configured to pass it): then consider OAuth 1.0a over HTTPS (not supported today) or Application Passwords.
- We need more than one external store: the values are a single URL and Secret.
- The external store sits behind a private link that needs more than an IPv4 CIDR on port 443.
