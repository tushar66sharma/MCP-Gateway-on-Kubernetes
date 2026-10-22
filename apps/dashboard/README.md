# dashboard

The team dashboard (Phase 4): a React single-page app for the MCP gateway. It shows server health, lets admins manage MCP servers and the team, lets everyone manage their own API keys, read the audit log and use the chat agent. It talks only to the gateway's `/api` on the **same origin** and holds no secret of its own. In the cluster it is a static build served by unprivileged nginx at `http://app.localhost/` ([ADR-015](../../docs/decisions/ADR-015-dashboard-served-by-nginx.md)).

How to use every page (admin and member): [docs/run-guide.md, the dashboard](../../docs/run-guide.md#the-dashboard-phase-4). The flows with failure tables: [docs/workflows.md, workflows 12-16](../../docs/workflows.md#12-log-in-to-the-dashboard-and-what-happens-when-the-session-ends). Screenshots: [docs/screenshots/](../../docs/screenshots/overview.png).

## Stack (exact pins)

React 19.3.1, React Router 8.5.0 (data router), TanStack Query 5.104.4, Radix UI 1.8.1 (dialogs, menus, tabs, toasts), Tailwind CSS 4.3.3 with design tokens, lucide-react icons, Inter Variable self-hosted with `@fontsource-variable/inter` (no font CDN), Vite 8.3.4. Tests: Vitest with jsdom 30.1.3 and Testing Library; Playwright 1.64.1 for the browser smoke. TypeScript `strict` with `noUncheckedIndexedAccess`; the tsconfig overrides `module: ESNext`, `moduleResolution: Bundler`, `jsx: react-jsx`, `lib: [ES2023, DOM, DOM.Iterable]`, `noEmit`.

## Commands (from the repository root)

| Command | Does |
|---|---|
| `npm run dev -w @urumi/dashboard` | Dev server at `http://localhost:5173` (fixed port). `/api` and `/mcp` are proxied to `http://app.localhost`, so the cluster must be running. |
| `npm test -w @urumi/dashboard` | 113 component tests in 19 files (jsdom), about 12 s. Only `test/**/*.test.{ts,tsx}`; the Playwright specs never run here. |
| `npm run typecheck -w @urumi/dashboard` | `tsc` for the app and for `e2e/`. |
| `npm run build -w @urumi/dashboard` | Type-check and production build into `dist/` (no source maps). Vite warns that the single JS chunk is over 500 kB (about 570 kB, known). |
| `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check-dashboard.ps1` | The Playwright smoke against the deployed dashboard, desktop (1440 px) and mobile (390 px). Once: `npx playwright install chromium`. |

**The dev proxy and CSRF.** The gateway accepts a mutating `/api` call only with `Origin: http://app.localhost`. `vite.config.ts` rewrites `Origin` to that value **only** when the request has none or comes from the dev server itself (`http://localhost:5173`, `http://127.0.0.1:5173`); any other origin passes through unchanged and is refused, so development never loosens the guard. Open the dev server exactly at `http://localhost:5173` ([troubleshooting](../../docs/troubleshooting.md#the-vite-dev-server-gives-403-csrf_rejected)).

## Source layout

| Folder | Holds |
|---|---|
| `src/lib/` | `api.ts` (`apiFetch`, `ApiError`, `onUnauthenticated`), `auth.tsx` (`AuthProvider`, `useMe`, `RequireAuth`, `RequireRole`, login, logout, `useStartSession`), `queryClient.ts`, `format.ts`, `theme.ts`, `useMediaQuery.ts`, `useReturnFocus.ts`. |
| `src/components/ui/` | The design system: Button, Input, Select, Textarea, Checkbox, FormField, Badge, StatusBadge, Card, Table, ResponsiveTable, Dialog, ConfirmDialog, Toast, EmptyState, ErrorState, Skeleton, Spinner, CopyField, PageHeader. |
| `src/components/layout/` | AppShell (skip link, sidebar, top bar, `<main id="main">`), Sidebar, TopBar (title, theme menu, user menu), MobileNav (the drawer), BrandMark. |
| `src/features/` | `servers`, `keys`, `team`, `audit`, `chat`: each with its `api.ts` (queries and plain-function writes) and components. |
| `src/pages/` | Login, Overview, Servers, ServerDetail, Keys, Team, Audit, Chat, AcceptInvite, NotFound. |
| `src/styles/` | `tokens.css` (every colour as a CSS variable for light and dark, with the computed contrast ratios), `index.css`. |
| `test/` | Component tests and `helpers.tsx` (fetch mocks, providers). |
| `e2e/` | Playwright: `auth.setup.ts`, `smoke.spec.ts`, `chat.spec.ts`, `helpers.ts`. `e2e/.auth/` is git-ignored. |
| `nginx.conf` | The production server: security headers, SPA fallback, `/.well-known/` 404, asset caching, `/healthz`. |

## Rules the code follows

- **Requests.** `apiFetch` sends `Content-Type: application/json` on every mutating call, including a `DELETE` without a body; credentials are `same-origin`. Errors become `ApiError {code, status, requestId, details, retryAfterSec}`; a network failure or a non-JSON answer becomes `NETWORK`; an abort is rethrown untouched. Any `401 UNAUTHENTICATED` (except from the login call) clears the query cache and sends the user to `/login?next=<path>`; a `401` from logout counts as logged out.
- **Secrets stay out of caches and storage.** Creating a key, creating an invite and saving a server (which may carry a credential) are plain async functions, not `useMutation`, so the plaintext never sits in the query cache. The one-time key and invite link live only in component state. The only thing in `localStorage` is the theme (`urumi.theme`).
- **The one-time key dialog** cannot be dismissed with Esc or a click outside, and **Close** unlocks only after "I have copied the key" is ticked.
- **Chat replies are plain text** (`whitespace-pre-wrap`), never rendered as Markdown or HTML. Provider error text is never shown; each error code has its own message, and executed tool calls are listed after an error ("These actions already ran").
- **Every data view** has a loading skeleton, an empty state and an error state with **Try again**; destructive actions use `ConfirmDialog`; forms validate inline and map `details.issues` to fields; server status refetches every 10 s.
- **Roles.** Admin-only controls are hidden from members (no Add server, Edit, Team page or audit user filter), but the gateway enforces every rule itself.

## Design system

Neutral slate surfaces with one indigo accent; a dark slate navigation rail in both themes with an indigo "signal line" on the active page; status colours always paired with a text label (green **Connected**, red **Unreachable**, grey **Disabled**, a hollow ring for **Not checked yet**); Inter at 14 px body text; a 4 px spacing scale; borders instead of shadows except for floating layers. Light and dark themes come from CSS variables (`light-dark()`, polyfilled by Lightning CSS in the build): the system setting by default, or System / Light / Dark from the theme menu. Every text pair meets WCAG AA (4.5:1; the ratios are listed in `tokens.css`), focus rings are visible, inputs are labelled, dialogs trap focus and return it to the opener. Below 1024 px the sidebar becomes a drawer; below 640 px tables become stacked cards (only one of the two is rendered).

## Build and image

`docker/dashboard.Dockerfile`: a `node:24-alpine` stage runs `npm ci` for the root and this workspace and `npm run build`; the runtime stage is `nginxinc/nginx-unprivileged:1.30.6-alpine` with `dist/` and `nginx.conf`, running as uid 101 on port 8080 with a read-only root filesystem (`/tmp` is an emptyDir). `scripts\build-images.ps1` builds it as `urumi/dashboard:<tag>` with the other images, and `scripts\up.ps1 -Redeploy` rolls it out. Headers on every response: the CSP (`script-src 'self'`, `frame-ancestors 'none'`, …), `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy` ([security.md](../../docs/security.md#10-browser-headers-and-the-dashboard)).

## Known limits

- One JS bundle of about 570 kB (route-level code splitting would help).
- A user who forced the theme opposite to their OS may see a short flash on load: the CSP forbids the inline script that would prevent it.
- The conversation is kept only in the tab (a reload clears it).
- Deferred review minors: the 403, error and Not found views have no `<h1>`; after navigating from the drawer, focus is not moved to `#main`; the "You're sending messages too quickly" message does not show the seconds (Retry stays disabled meanwhile); the composer can still send during a rate-limit countdown; an earlier assistant reply over 4,000 characters is cut to 4,000 in the next request; the audit filters do not reject a `from` later than `to`; a role change applies at once without a confirmation; the nginx access log records invite-link paths with their token ([security.md](../../docs/security.md#8-residual-risks)).
