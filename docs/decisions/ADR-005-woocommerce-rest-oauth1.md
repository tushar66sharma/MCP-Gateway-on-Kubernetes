# ADR-005: WooCommerce MCP talks to the store via REST v3 + OAuth1

## Status

Accepted (2026-10-18, Phase 1 spike). The spike passed, so the application-passwords fallback is not needed. Phase 2 (2026-10-18/19) built the MCP server on this decision and verified the items the spike left open; see "Phase 2 results" below.

## Date

2026-10-18

## Context

`apps/mcp-woocommerce` (namespace `mcp`) must read and write products and orders in WooCommerce (namespace `store`). The assignment asks us to document how the MCP server talks to the store. In-cluster traffic is plain HTTP: the server will call `http://wordpress.store.svc.cluster.local/wp-json/wc/v3/...` (Phase 2), while WordPress's `WP_HOME` is `store.localhost`.

## Decision

We call the **WooCommerce REST API v3** with the store's consumer key/secret, signed with **OAuth 1.0a (one-legged)**. WooCommerce documents OAuth1 as the method for plain-HTTP connections. The key is created by the idempotent `store-setup` Job (read/write, hashed with `wc_api_hash` through `wp eval-file`) and delivered via Secret `store-woo-api`. Since Phase 2 the key is owned by a dedicated least-privilege user, not the administrator (see "Key owner" below).

**Spike result (verified 2026-10-18 on WooCommerce 11.2.1):** `scripts/check-woo-api.ps1` port-forwards the in-cluster Service `wordpress` and sends an OAuth1 HMAC-SHA256 request from outside the WordPress pod to `http://127.0.0.1:<port>/wp-json/wc/v3/products`. The results:

- Signed with the **public store URL** as the signature base (`http://store.localhost` + path, scheme always `http`): **HTTP 200** with product JSON.
- Signed with the **URL actually requested** (the Service or port-forward address): **HTTP 401** `woocommerce_rest_authentication_error`, "Invalid signature - provided signature does not match."

**Why:** WooCommerce's `check_oauth_signature()` (`includes/class-wc-rest-authentication.php`, line 581 in 11.2.1) rebuilds the signature base URI from its own configuration, not from the request's Host header:

```php
$base_request_uri = rawurlencode( get_home_url( null, $request_path, is_ssl() ? 'https' : 'http' ) );
```

`get_home_url()` returns the `WP_HOME` host (`store.localhost`), and the scheme is `http` for any non-TLS request. So the client must compute the signature over the `WP_HOME` URL with its scheme replaced by `http` (plus the path; the port only if `WP_HOME` has one) while sending the request to any reachable address (for example `http://wordpress.store.svc.cluster.local`). The reference signer is `signOAuth1Url()` in `scripts/dev/woo-oauth-check.mjs`.

**Consequence for Phase 2:** `WooClient` takes two URLs: the `baseUrl` it connects to (the in-cluster Service) and a separate `signingBaseUrl` (the public store URL, `http` scheme). Both come from configuration. **Built:** `WOO_BASE_URL` is `http://wordpress.<store namespace>.svc.cluster.local`, and `WOO_SIGNING_BASE_URL` is produced by the chart helper `urumi.storeSigningBaseUrl` (the output of `urumi.publicUrl` with its scheme replaced by `http`), so it cannot drift from `WP_HOME`.

**What the Phase 1 spike did and did not exercise.** It reached the store through `kubectl port-forward` to the `wordpress` Service (`http://127.0.0.1:<port>`) and sent only GET requests. Requests to the in-cluster Service DNS name (`wordpress.store.svc.cluster.local`) and signed writes were left for Phase 2, which is now done (next section).

**Timestamp window and nonces.** WooCommerce rejects OAuth timestamps more than 15 minutes (plus or minus) from the server's time, and stores used nonces per consumer key, so a nonce can never be reused. Consequences: clock skew between the client and the cluster larger than 15 minutes produces 401 errors that look like signature failures, and a retry must always generate a fresh nonce (never replay the same request).

**Signing base rule and ports:** WooCommerce builds the base with `get_home_url(null, $path, is_ssl() ? 'https' : 'http')`. In-cluster calls are never TLS, so the scheme is `http`, and `set_url_scheme()` only swaps the scheme. The signing base is therefore the public store URL (`urumi.publicUrl`, i.e. `WP_HOME`) with its scheme replaced by `http`. The port stays only if it is present in `WP_HOME`, which is the case only when `publicPort` is not the default for `publicScheme`. Local: `http://store.localhost`; local on 8081: `http://store.localhost:8081`; production https/443: `http://store.example.com` with no `:443`. `check-woo-api.ps1` now derives its `--sign-base` from the release values by the same rule as the chart helper. A non-default port renders correctly in the chart (`helm template --set global.publicPort=8081` gives `http://store.localhost:8081`), but was not run end to end.

## Phase 2 results

**Verified in the cluster (2026-10-18, Task 2.6, via `scripts/check-mcp-woocommerce.ps1` and `-Write`):**

- **Service-DNS access works.** The MCP server pod reaches `http://wordpress.store.svc.cluster.local` and WooCommerce accepts signatures computed over `http://store.localhost`, exactly as predicted from `get_home_url()`.
- **Signed POST and PUT work.** `create_product` (POST, created draft product 26) and `update_order_status` (PUT, order 25 kept as `processing`) succeeded. For JSON bodies the body is not part of the OAuth1 base string, so signing is the same as for GET.
- The `WooClient` signer was ported from the spike (`scripts/dev/woo-oauth-check.mjs`) and checked against the same PHP-generated known-answer vector.

**Behaviour built into `WooClient`:**

- A fresh random nonce and timestamp for every request, and **no retries**: a replayed nonce is rejected, and `create_product` is not idempotent.
- `redirect: 'manual'`: a 3xx is reported as an error instead of being followed with a stale signature.
- Per-request timeout `WOO_TIMEOUT_MS` (default 10000); timeouts and network errors become tool results with `isError: true`.
- WooCommerce error text is scrubbed of `oauth_*` values and of the configured key and secret before it reaches a result or a log.
- The signer rejects query keys PHP would parse differently (`[]`, `.`, spaces, duplicates) and caller-supplied `oauth_*` keys. Pretty permalinks are required (the setup Job enables them).

## Key owner (least privilege)

The REST key belongs to a dedicated WordPress user **`urumi-mcp` with the `shop_manager` role**, not to the administrator. Impact of a leaked key: the holder can read and change products and orders, but cannot install plugins, edit themes or manage users. The setup Job (`charts/urumi-platform/files/store-setup/setup.sh`) creates the user with a random 32-character password that is never shown, and `upsert-api-key.php` assigns the key to it (it also fails unless the owner has `manage_woocommerce`). Verified 2026-10-19 in the live database: one key row, `urumi-mcp`, `read_write`; role `shop_manager`.

**Atomic upsert.** The key row is found by its description, **updated in place** when it exists (same `key_id`, nonces kept) and inserted only when it does not; extra duplicate rows are deleted. The earlier delete-then-insert left a window with no valid key and a new `key_id` on every run. Verified: `key_id` stayed 4 across two redeploys.

**Ownership marker (security fix).** The Job marks the user it creates with user meta `urumi_managed_key_owner=1` and **refuses to promote or reuse a `urumi-mcp` user that lacks the marker** (the Job fails with "missing urumi_managed_key_owner marker"). Reason: customer registration is open and WooCommerce derives the login from the e-mail address, so an attacker could register `urumi-mcp@example.com`, obtain a customer account with the login `urumi-mcp` before setup ever ran, and have the Job promote that account to shop manager and issue the key to it. The PHP upsert re-checks the marker. Proven in Task 2.5 by running the PHP check against a throwaway unmarked shop manager (refused, nothing written); the shell branch of `setup.sh` was syntax-checked but not run live. **Upgrade note:** a store set up before this fix has an unmarked `urumi-mcp`; add the marker once (procedure in [troubleshooting](../troubleshooting.md#the-store-setup-job-fails-with-missing-urumi_managed_key_owner-marker)) or the Job will keep refusing. The remaining exposure (open registration itself) is a demo setting, tracked for Phase 5, and the key owner is to be covered in the Phase 6 threat model. `docs/security.md` does not exist yet (Phase 5/6).

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
- `WooClient` needs the extra `signingBaseUrl` setting; if it is missing or wrong, every call returns 401 even though the key is valid.
- The key is written directly into `wp_woocommerce_api_keys` by `upsert-api-key.php` (consumer key hashed with `wc_api_hash`; update-in-place, then insert), with the secret value coming from the `store-woo-api` Kubernetes Secret. That way the value survives chart upgrades. The spike and Phase 2 confirm WooCommerce accepts a key created this way. The `mcp` namespace holds a byte-identical copy of the Secret (rendered by one shared helper, `urumi.storeWooApiData`), because Secrets cannot cross namespaces.
- The reference signer (`scripts/dev/woo-oauth-check.mjs`) supports only unique scalar query keys; pass lists comma-separated (`include=1,2`), because PHP's array parsing (`include[]`), repeated keys and `.`/space rewriting in keys cannot be signed identically. Parameters are sorted by raw key in byte order like WooCommerce's `uksort( $params, 'strcmp' )`, and `scripts/dev/woo-oauth-check.test.mjs` checks the output against a vector generated by an independent PHP implementation.
- POST and PUT signing (the body is not part of the OAuth1 base string for JSON requests) was verified in Phase 2 (see above).
- Rotating a pre-created `storeWooApi` Secret does not restart the MCP pod automatically; the operator runs `kubectl -n mcp rollout restart deploy/mcp-woocommerce` ([deployment.md](../deployment.md#known-limitation-rotating-a-pre-created-woocommerce-key-secret)).

## Revisit if

- A WooCommerce upgrade changes how `check_oauth_signature()` builds the base URI (re-run `scripts/check-woo-api.ps1`; it is the regression check).
- The public URL scheme or port changes (update `signingBaseUrl` accordingly).
- The store gets in-cluster TLS, which would allow plain Basic auth with the consumer key.
- TLS is added in Phase 5: the official image's `wp-config.php` may honor `X-Forwarded-Proto` for `is_ssl()`, but that only affects browser traffic that passes through Traefik. In-cluster MCP calls bypass Traefik and carry no `X-Forwarded-Proto` header, so `is_ssl()` stays false and the signing scheme stays `http` even with TLS at the Ingress. The MCP client must never send `X-Forwarded-Proto`. Whether the image honors the header at all is not checked yet; verify it in Phase 5.
