# ADR-015: Serve the dashboard from its own unprivileged nginx pod, same origin as the API

## Status

Accepted. **Implemented in Phase 4** (2026-10-19).

## Date

2026-10-19

## Context

The dashboard is a static single-page application (React + Vite build: one `index.html`, hashed JS/CSS and font files). It must be reachable at `http://app.localhost/` (production: the real app host) and it calls the gateway's `/api` with the session cookie `ugw_session`. The gateway's CSRF guard requires every mutating `/api` call to carry `Content-Type: application/json` **and** an `Origin` equal to `PUBLIC_APP_URL`, and the cookie is `SameSite=Lax`. The SPA needs a fallback (any unknown path such as `/servers/123` or `/invite/<token>` must answer `index.html`) and the HTML needs security headers (CSP, `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy: no-referrer`). MCP clients probe `/.well-known/oauth-*` after a 401 and must get a 404, not the SPA. Every pod follows the workload standard (spec §8.5: non-root, read-only root filesystem, dropped capabilities).

## Decision

- A separate **`dashboard` Deployment and Service** in namespace `gateway`, image `urumi/dashboard:<tag>`: a `node:24-alpine` build stage, then **`nginxinc/nginx-unprivileged:1.30.6-alpine`** serving `dist/` on port 8080 as uid/gid 101 (`docker/dashboard.Dockerfile`, `apps/dashboard/nginx.conf`).
- The existing Ingress for `app.localhost` routes `/` (Prefix) to `dashboard`, while `/api` and `/mcp` keep going to `gateway`. Browser, dashboard and API therefore share **one origin**, so the session cookie, `SameSite=Lax` and the CSRF `Origin` check work unchanged.
- nginx sets the four security headers once at server level with `always`; locations only set a `$cache_control` variable (an `add_header` inside a location would silently drop the server-level ones). `/assets/` is cached for a year (`immutable`, hashed names) and 404s for a missing file; `/` falls back to `index.html` with `no-cache`; `/.well-known/` answers 404; `/healthz` answers `ok` for the probes.
- Pod: `runAsNonRoot`, uid/gid 101, seccomp `RuntimeDefault`, no service-account token, `allowPrivilegeEscalation: false`, `capabilities.drop: [ALL]`, read-only root filesystem with an `emptyDir` at `/tmp`, probes on `GET /healthz`, requests 10m/16Mi, limits 100m/64Mi. Rendered only when `gateway.enabled` and `dashboard.enabled` are both true.

## Alternatives considered

- **Serve the SPA from the gateway process** (Express static files plus a fallback in `extraRoutes`). Rejected: it mixes a static-file concern into the API and MCP server; the SPA fallback would need a carve-out so `/mcp`, `/api`, `/healthz` and `/readyz` never answer `index.html`, which is easy to get wrong; the HTML headers would have to be added to a process whose responses are mostly JSON-RPC; and a dashboard change would restart the gateway (which uses the `Recreate` strategy, so a few seconds of `/mcp` downtime per UI change).
- **A Vercel- or Netlify-style static host for the frontend.** Rejected for local use, and not chosen for production: a different origin breaks the same-origin model. The cookie would be cross-site (`SameSite=None; Secure` and HTTPS everywhere), the CSRF guard would have to accept a second origin and CORS would need credentials, all of which loosen the security model; and the local stack would need an internet host. The production target is one k3s VPS ([ADR-012](ADR-012-deployment-target-k3s-vps.md)), where an extra pod costs almost nothing.
- **The official `nginx` image.** Rejected: it starts as root to bind port 80. `nginx-unprivileged` runs as uid 101 on 8080 and keeps its pid and temp files under `/tmp`, so the root filesystem can be read-only.

## Consequences/trade-offs

- One more Deployment and image to build (`build-images.ps1` builds five images now), but the dashboard can be redeployed without touching the gateway, and it uses about 1m CPU and 7Mi memory (**live**, `kubectl top`).
- Same origin means no CORS and no CSRF exceptions; the Vite dev server reproduces it by proxying `/api` and `/mcp` to `http://app.localhost` and rewriting `Origin` only when it is missing or is the dev server's own origin, so the guard is never loosened.
- `script-src 'self'` forbids inline scripts, so the theme preference is applied by CSS and a bundled script; a user who forced the opposite of their OS theme may see a short flash on load.
- nginx's `worker_processes auto` starts one worker per node CPU (8 on the reference machine; memory stays about 7Mi). The dashboard `/tmp` emptyDir has no size limit. Both are Phase 5 hardening candidates.
- Verified (2026-10-19, live through Traefik): `/` and `/servers` answer 200 with the CSP and the other headers; `/.well-known/oauth-authorization-server` 404; `/assets/<hash>.js` cached immutable and a missing asset 404 without `Cache-Control`; `/api/auth/me` still 401 JSON from the gateway with `nosniff` and `no-store`.

## Revisit if

- The dashboard needs server-side rendering or per-user HTML.
- A CDN is put in front of production; it must keep the single origin (route `/api` and `/mcp` through it) or the cookie and CSRF model must be redesigned.
