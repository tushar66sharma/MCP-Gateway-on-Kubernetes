# Definition-of-done demo script

This is the end-to-end walk-through that shows the whole platform working. Every step has the exact command or click and the result expected. **What was actually run on 2026-10-23**, on a freshly recreated cluster: the steps were executed at **API level** (login, chat, invite, accept, key creation, revoke, disable, listing servers, audit) with a scratch PowerShell script, plus the real MCP Inspector CLI for steps 6 and 9.3, plus `kubectl` for the pod kill. The numbers in "Expected" are what those calls returned. The dashboard pages use the same API calls, and `scripts\check-dashboard.ps1` (Playwright) separately exercises the Overview, Servers, a key dialog and a chat page in Chromium; but **nobody clicked through this exact script in a browser**. Click-level expectations that were not observed are marked "(not click-verified)". Claude Code is left for you to try (step 6b), because it changes your Claude configuration.

Two people are used: **user A** is the administrator (`admin@example.com`), **user B** is a team member invited in step 4.

Nothing here prints a password, key or invite link. Commands read secrets into variables or the clipboard only. Run everything from the repository root in Windows PowerShell 5.1.

## 0. Before you start

1. Start the platform and check it:

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\up.ps1
   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\create-secrets.ps1     # AI chat key from .env (only after a cluster recreation)
   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\smoke-test.ps1 -Quick
   ```

   Expected: `up.ps1` ends with the URL block; `smoke-test.ps1 -Quick` ends with `SMOKE TEST PASSED` (6 PASS, 2 SKIPPED).

2. Copy the admin password to the clipboard (never printed):

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\get-secret.ps1 -Namespace gateway -Name gateway-bootstrap -Key password
   ```

## 1. User A logs in to the dashboard

1. Open <http://app.localhost/> and sign in as `admin@example.com`, pasting the password.
2. Expected: the Overview page lists three connected servers (`woo`, `notes`, `utils`) and 15 tools (the API returns this; the Overview page itself is covered by the Playwright smoke, not by clicking this script: not click-verified).

## 2. User A asks the chat for a cross-server task

1. Click **Chat** and send: `Create a draft product called Demo Lamp priced 25 and save a note reminding me to publish it.`
2. Expected: the reply says the draft was created and the note saved, and the trace shows two calls, both **Succeeded**: `woo__create_product` (arguments `name: "Demo Lamp"`, `regular_price: "25"`, `status: "draft"`) and `notes__create_note`. Observed 2026-10-23: product #14 as a draft, note #2, provider `groq`, model `openai/gpt-oss-120b`, 5,159 tokens.
3. Check in the store: <http://store.localhost/wp-admin/edit.php?post_type=product> shows **Demo Lamp** as a **Draft** at 25 (the API reply said draft #14 at 25; the wp-admin page was not opened: not click-verified).

This step spends free-tier LLM tokens (about 5,000). The chat acts as user A: the same permissions, audit log and tools as `/mcp`.

## 3. User A reads the audit log

1. Click **Audit log**.
2. Expected: two rows with source **chat** and user `admin@example.com`: `woo` `create_product` and `notes` `create_note`, both **success**.

## 4. User A invites user B

1. Click **Team** > **Invite**, enter an email such as `demo-b@example.com`, role **member**, and create the invite. Copy the one-time link (it is shown once).
2. Open the link in a **private window**, enter a name and a password of at least 10 characters, and accept.
3. Expected: user B lands in the dashboard, logged in; the invite is no longer pending (`GET /api/invites` returned 0 pending invites after the accept; the Team page itself: not click-verified). The nginx log of the dashboard shows the page only as `/invite/:token` (check: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check-invite-log.ps1` prints `Invite-log check passed`).

## 5. User B creates an API key

1. As user B, open **API keys** > **Create key**, name it `demo-inspector`, and create it.
2. Expected: the API returns the key once (observed: `201`); the one-time dialog (starts with `ugw_`, Close disabled until ticked) is covered by the Playwright smoke but was not clicked in this script (not click-verified); tick "I have copied the key" to close it. Put it into an environment variable **without printing it**, for example by pasting it at the prompt:

   ```powershell
   $sec = Read-Host "Paste user B's key" -AsSecureString
   $env:UGW_KEY = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
   ```

## 6. User B uses the key with the MCP Inspector CLI

1. List the tools:

   ```powershell
   npx -y @modelcontextprotocol/inspector@2.11.0 --cli http://app.localhost/mcp --transport http --header "Authorization: Bearer $env:UGW_KEY" --method tools/list
   ```

   Expected: 15 tools: `notes__create_note`, `notes__delete_note`, `notes__list_notes`, `notes__ping`, `notes__search_notes`, `utils__calculate`, `utils__current_time`, `utils__date_range`, `utils__ping`, `woo__create_product`, `woo__get_order`, `woo__list_orders`, `woo__list_products`, `woo__ping`, `woo__update_order_status`. Exit code 0.

2. Call one tool:

   ```powershell
   npx -y @modelcontextprotocol/inspector@2.11.0 --cli http://app.localhost/mcp --transport http --header "Authorization: Bearer $env:UGW_KEY" --method tools/call --tool-name utils__calculate --tool-arg expression="25*4"
   ```

   Expected: `"text": "25*4 = 100 ..."` and `structuredContent` `{ "expression": "25*4", "result": 100 }`; exit code 0.

   (On Windows the Inspector can print a libuv assertion `UV_HANDLE_CLOSING` and exit with a large negative code **after** an error response while closing; the result above is not affected.)

### 6b. Claude Code (for you to try; not run by this script)

The run guide has the command, [Connect Claude Code](run-guide.md#connect-claude-code-for-you-to-try). It adds an MCP server to your own Claude configuration, so it is left to you. Use a key created in the dashboard and do not paste it anywhere visible.

## 7. User A revokes user B's key

1. As user B (or user A on the Team page, **Keys** of user B), click **Revoke** on `demo-inspector`.
2. Repeat the `tools/list` command of step 6.1.
3. Expected: the revoke answers `204`; `tools/list` now fails with HTTP **401** (JSON-RPC error `-32001`, "Unauthorized"). Observed with a direct request: `HTTP 200` before the revoke, `HTTP 401` after.

## 8. User A disables user B and B's session ends

1. User A: **Team**, row of user B, **Disable**.
2. In user B's browser window click any page (or reload).
3. Expected: `GET /api/auth/me` with B's session answers **401** (observed: `200` before, `401` after). That B is then sent to the login page in the browser, and cannot log in again until re-enabled, were not click-verified.

## 9. A server pod dies and recovers

1. Keep the **Servers** page open as user A (it refreshes every 10 s), or watch from PowerShell. Kill the notes server:

   ```powershell
   kubectl -n mcp delete pod -l app.kubernetes.io/name=mcp-notes
   ```

2. Expected, observed 2026-10-23: the server `notes` shows **Unreachable** (`lastError` `connection refused`) after about 5 s and **Connected** again after about 20 s, well inside 30 s (the gateway checks every 15 s; the new pod needs a few seconds to start).
3. While it is Unreachable, call a notes tool with any valid key (for example from the Inspector: `--method tools/call --tool-name notes__list_notes`). Expected: no crash and no hang; a clean tool error: `Server 'notes' is disabled or unreachable` (HTTP 200 with `isError: true`). After recovery the same call succeeds. The notes stored in memory are lost with the pod (by design: notes are kept in memory).

## 10. The audit log shows every step

1. As user A open **Audit log** (or call `GET /api/audit?limit=60`).
2. Expected (observed rows, newest first): `auth_rejected` for user B's revoked key (source **mcp**, outcome `unauthorized`); the denied notes call from step 9; `tool_call` `notes` `create_note` and `woo` `create_product` (source **chat**, user A); `tool_call` `utils` `calculate` (source **mcp**, user B); and user A's earlier `mcp` calls from `check-gateway.ps1`. Each row has the right user and source; the notes call made during the outage is recorded as `tool_call` `notes` `list_notes` with outcome **denied** (observed: the gateway refused it because the server was unreachable).

## 11. Clean up (optional)

- Delete the **Demo Lamp** draft in wp-admin (Products > Trash > Delete permanently) and delete the demo notes with `notes__delete_note`.
- `Remove-Item Env:UGW_KEY`.
- Disabled user B stays in the Team list; leave it or re-enable it.

## What this proves, in one line each

| Definition-of-done bullet | Step |
|---|---|
| The admin uses the chat for a task that spans two servers | 2 |
| Every action is audited with the right user and source | 3, 10 |
| A teammate joins by one-time invite | 4 |
| A teammate's personal key works with a standard MCP client | 5, 6 |
| Revoking the key cuts access at once | 7 |
| Disabling the user ends their session | 8 |
| A dead server is reported honestly and recovers without help | 9 |
