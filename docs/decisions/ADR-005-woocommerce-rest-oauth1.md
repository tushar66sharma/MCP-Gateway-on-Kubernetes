# ADR-005: WooCommerce MCP talks to the store via REST v3 + OAuth1

## Status

Proposed. Finalized in Phase 1 after the auth spike confirms the signature works across the in-cluster hostname. Fallback if it does not: WordPress application passwords.

## Date

2026-10-18

## Context

`apps/mcp-woocommerce` (namespace `mcp`) must read and write products and orders in WooCommerce (namespace `store`). The assignment asks us to document how the MCP server talks to the store. In-cluster traffic is plain HTTP: the server calls `http://wordpress.store.svc.cluster.local/wp-json/wc/v3/...`, while WordPress's `WP_HOME` is `store.localhost`.

## Decision

We call the **WooCommerce REST API v3** with the store's consumer key/secret, signed with **OAuth 1.0a (one-legged)**. WooCommerce documents OAuth1 as the method for plain-HTTP connections. The key is created by the idempotent `store-setup` Job (read/write, hashed with `wc_api_hash` through `wp eval`) and delivered via Secret `store-woo-api`.

**Known risk:** the OAuth1 signature covers the URL, but the server calls the Service hostname while `WP_HOME` differs. The signature base string must use exactly the URL the client requests. The spike verifies this before the ADR is finalized.

**Fallback:** WordPress application passwords with `WP_ENVIRONMENT_TYPE=local` (documented), if OAuth1 cannot be made to work with the Host header.

## Alternatives considered

- **WP-CLI via `kubectl exec`.** Rejected: the MCP pod would need Kubernetes API credentials with exec rights into the `store` namespace, a large privilege, and the coupling depends on pod names.
- **Direct SQL against MariaDB.** Rejected: it bypasses WooCommerce logic (totals, stock, status transitions, hooks, caches) and ties us to the internal schema.
- **Basic auth with the consumer key.** Rejected: WooCommerce only accepts it over HTTPS, and in-cluster traffic is HTTP.
- **WordPress application passwords.** Kept as the fallback rather than the primary: they also require HTTPS unless the environment type is `local`, which is a weaker story for a production-like setup.

## Consequences/trade-offs

- The MCP server needs only network reach to `wordpress` and a consumer key/secret; no Kubernetes permissions, no database credentials.
- WooCommerce business rules stay in WooCommerce.
- We must implement and unit-test OAuth1 signing ourselves (the integration test against a mocked REST API checks the signature).
- Signature/Host mismatches can show up as confusing 401s; the spike and troubleshooting docs must cover this.
- Nothing is implemented yet; this ADR becomes Accepted only when the spike passes.

## Revisit if

- The spike fails and we switch to application passwords (supersede or update this ADR).
- The store gets in-cluster TLS, which would allow plain Basic auth with the consumer key.
