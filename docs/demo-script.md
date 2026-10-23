# Definition-of-done demo script

This is the walk-through that shows the whole platform working, in the order of the assignment's definition of done: **Store, Chat agent as user A, External MCP client as user B, Team and control, Audit**. Every step has the command or click, the expected result and what was observed.

**What was run (2026-10-23, local k3d cluster `k3d-urumi`).** The whole script was executed live at **API level** with a scratch Node script (not committed): login, chat, invite, accept, keys, server disable and enable, audit, plus the real **MCP Inspector CLI** (`@modelcontextprotocol/inspector@2.11.0`) for the external client and `kubectl` for the pod kill. Steps that are verified only this way say "(verified via API; click-through not run)": the dashboard pages call the same API, but nobody clicked through this exact script in a browser. **Claude Code** is not run here: it is the owner's live step, marked as such.

Two people: **user A** is the administrator (`admin@example.com`); **user B** is a fresh invited member (`demo-b-<timestamp>@example.com`). Nothing here prints a password, key or invite link; secrets go into variables only.

Run everything from the repository root in Windows PowerShell 5.1.

## 0. Before you start

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\up.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\smoke-test.ps1 -Quick
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\get-secret.ps1 -Namespace gateway -Name gateway-bootstrap -Key password   # copies the admin password to the clipboard
```

The chat steps spend the free-tier LLM quota (about 3,000 to 5,500 tokens per turn, observed). The per-user daily chat budget is 50,000 tokens (`gateway.chat.dailyTokenBudget`); the five turns of this run cost about 15,000 to 18,000 in total (the failed turn's usage is not reported).

## 1. Store: storefront to checkout to wp-admin

1. Open <http://store.localhost/>, open a product, **Add to cart**, go to **Checkout**, fill in the address and choose **Cash on delivery**, then **Place order**.
2. Open <http://store.localhost/wp-admin/> > **WooCommerce > Orders**: the order is listed (status Processing).

Observed 2026-10-23 (verified via API; click-through not run): the checkout was driven through the WooCommerce Store API by `scripts\dev\customer-order-smoke.ps1` (registers a customer, adds the item, checks out with `payment_method=cod`, and checks **My Account > Orders**; it prints the order id and never the generated password). It reported `SMOKE PASSED` and created order **#20**, which the gateway's `woo__list_orders` (step 3) and the chat (step 2) then returned as `processing`, total 25.00. The script takes `-ProductId <id>` to order a chosen product:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dev\customer-order-smoke.ps1 -ProductId 19
```

## 2. Chat agent, as user A

Open <http://app.localhost/>, sign in as `admin@example.com`, click **Chat**.

1. Send: `Create a product called Demo Lamp priced 25`. Do not ask for a draft: `create_product` publishes by default.
   - Observed: the reply said `Product created: Demo Lamp (ID 19) priced at 25.`; one tool call `woo__create_product` (arguments `name: "Demo Lamp"`, `regular_price: "25"`), **success**, 501 ms; the tool result says `(publish)`. Provider `groq`, model `openai/gpt-oss-120b`, 3,349 tokens.
   - The product page opens: `GET http://store.localhost/product/demo-lamp/` returned **HTTP 200** and the page contains `Demo Lamp`. The Store API lists it (id 19, slug `demo-lamp`, price 25.00).
2. **Place an order for that product by hand** on the storefront (step 1 with Demo Lamp). Observed: order **#20** (via the script above, `-ProductId 19`).
3. Send: `What orders came in today?`
   - Observed: the reply listed `Order #20: USD 25.00, status processing, 1 item` and `Order #15: USD 4.00, status processing` (an earlier smoke order from the same day); tool call `woo__list_orders` with `period: "today"`, **success**, 3,463 tokens.

(verified via API; click-through not run)

## 3. External MCP client, as user B (an invited member)

**Create user B.** As user A, **Team > Invite**, enter `demo-b-<timestamp>@example.com`, role **member**, copy the one-time link (shown once). Open it in a private window, enter a name and a password of at least 10 characters. Observed: invite `201`, accept `201`, user B has role `member`. B then opens **API keys > Create key**, names it `demo-inspector`; observed `201`, key of 47 characters starting with `ugw_`. Put it in a variable without printing it:

```powershell
$sec = Read-Host "Paste user B's key" -AsSecureString
$env:UGW_KEY = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
```

**Connect with only the gateway URL and B's key (MCP Inspector CLI).**

```powershell
npx -y @modelcontextprotocol/inspector@2.11.0 --cli http://app.localhost/mcp --transport http --header "Authorization: Bearer $env:UGW_KEY" --method tools/list
npx -y @modelcontextprotocol/inspector@2.11.0 --cli http://app.localhost/mcp --transport http --header "Authorization: Bearer $env:UGW_KEY" --method tools/call --tool-name woo__list_orders --tool-arg period=today
```

- Observed `tools/list` (exit 0): **15 tools of 3 servers**: woo 6 (`woo__create_product`, `woo__get_order`, `woo__list_orders`, `woo__list_products`, `woo__ping`, `woo__update_order_status`), notes 5 (`notes__create_note`, `notes__delete_note`, `notes__list_notes`, `notes__ping`, `notes__search_notes`), utils 4 (`utils__calculate`, `utils__current_time`, `utils__date_range`, `utils__ping`).
- Observed `woo__list_orders period=today` (exit 0): `Found 2 order(s) on page 1` with order **#20** (25.00, processing) and #15: the same order the chat listed.
- On Windows the Inspector can print a libuv assertion at exit; the result above it is valid.

**Two-server prompt.** Chaining two servers needs an LLM client; MCP Inspector cannot do it.

- **Run here, through the chat as user B (one turn):** `Show today's orders and save a note listing their numbers`. Observed: the reply was `Order numbers today: 20, 15` and `Note saved with ID 2 titled "Today's orders"`; tool calls `woo__list_orders` then `notes__create_note`, both **success**; both are in the audit log as source `chat`, user B (step 5). The first attempt of this turn returned `502 LLM_BAD_RESPONSE` after `woo__list_orders` had succeeded (the model's reply could not be used; this is the documented provider-error path, and the executed tool call is returned with the error). The second attempt, as a second fresh invited member, succeeded. Both users are in the Team list, enabled.
- **Owner's live step (not run, no `claude` CLI on the owner's machine):** the same prompt in **Claude Code**, using the `.mcp.json` + `URUMI_GATEWAY_KEY` route from [Connect Claude Code](run-guide.md#connect-claude-code). Expected (not tested): `/mcp` lists `urumi-gateway` as connected; the prompt calls `woo__list_orders` and `notes__create_note` as user B. Cursor is an alternative.

## 4. Team and control

### Revoke B's key

As user B, **API keys > Revoke** on `demo-inspector`; then repeat the `tools/list` command.

Observed: revoke `204`; a direct `POST /mcp` with the revoked key returned **HTTP 401** (`{"jsonrpc":"2.0","error":{"code":-32001,"message":"Unauthorized"},"id":null}`). The Inspector treats a 401 as an OAuth challenge: in a terminal without a TTY its default mode prints `auth_required ... Interactive OAuth requires a TTY`; with `--stored-auth-only` it prints the underlying `Error POSTing to endpoint: ... "code":-32001,"message":"Unauthorized"` (both exit 3). So the 401 is plain only with a direct request or `--stored-auth-only`. (verified via API; click-through not run)

### Disable one upstream server (`notes`)

1. **Servers > notes > Disable** (API: `PATCH /api/servers/<id>` with `{"enabled":false}`, observed `200`).
2. External client: `tools/list` now returns **10** tools (woo 6, utils 4; no `notes__*`); it was 15. Observed within the first poll.
3. Chat: send `save a note: test` as user A. Observed: **no `notes__*` tool call** (the call list was empty); the reply was `I can only help with this store, your notes and small utility tasks (calculations, dates and times) in this dashboard.` That is the scope refusal, not a clear "notes is disabled" message: the model had no notes tool and the topic rule refused. The behaviour the demo needs (the chat cannot save the note) holds; the wording does not name the disabled server.
4. **Servers > notes > Enable** (observed `200`); `tools/list` returned **15** again.

(verified via API; click-through not run)

### Kill the pod of one upstream server

```powershell
kubectl -n mcp delete pod -l app.kubernetes.io/name=mcp-utilities
```

Observed: `utils` showed `unreachable` (`lastError` `connection refused`) after **3.7 s**; meanwhile a `woo__list_products` call through the gateway succeeded (**HTTP 200**, `isError` false); `utils` was **connected** again (4 tools) **19.9 s** after the kill (the gateway checks every 15 s). While it was down, a `utils__calculate` call got a clean tool error (HTTP 200, `isError: true`, `Server 'utils' is disabled or unreachable`), recorded in the audit log as `denied`. After recovery the same call returned `6*7 = 42`. The dashboard's Servers page shows the same status (Unreachable, then Connected); the API is what was observed.

## 5. Audit

Open **Audit log**, or call the API as user A with the time filter below (observed rows are from the run, `from` = the start of the run):

```powershell
Invoke-RestMethod -Uri "$base/api/audit?from=<start-iso>&limit=100" -WebSession $s     # all users (admin); add &userId=<B's id> for one user
```

Observed rows (oldest first; user B in the rows is the first invited member, `demo-b-...160055`; `-` = none):

| id | event | source | user | server / tool | outcome |
|---|---|---|---|---|---|
| 110 | tool_call | chat | A | woo / create_product | success |
| 113 | tool_call | chat | A | woo / list_orders | success |
| 114 | tool_call | mcp | B | woo / list_orders | success |
| 115 | tool_call | chat | B | woo / list_orders | success |
| 116, 117 | auth_rejected | mcp | B | - | unauthorized (`API key revoked`) |
| 118 | tool_call | mcp | B | woo / list_products | success |
| 119 | tool_call | mcp | B | utils / calculate | denied (`Server 'utils' is disabled or unreachable`) |
| 120 | tool_call | mcp | B | utils / calculate | success (after recovery) |

For the second member (`demo-b-...160224`): `woo/list_orders` and `notes/create_note` as source `chat`, both success (ids 121 and 122), then three `auth_rejected` / `unauthorized` rows for the revoked key (ids 123 to 125). The disabled-notes chat turn (user A) wrote no audit row, because no tool call was made. Every call above is attributed to the right user and source; the filter by `userId` returned 7 rows for the first member and 5 for the second.

## 6. Traceability: assignment definition of done to this script

The bullets are the assignment's definition of done as listed in the Phase 6 plan (the PDF could not be rendered in the session that wrote this table; check the wording against page 3).

| Definition of done | Demo step | Evidence |
|---|---|---|
| A customer can order from the storefront and the order appears in WooCommerce | 1 | Order #20, COD, `processing` (via API); wp-admin click-through not run |
| User A, in the chat agent, manages the store (creates a product that shows on the storefront) | 2 | Product 19 `publish`; `/product/demo-lamp/` HTTP 200; chat tool call success |
| The chat answers a store question with real data | 2 | "What orders came in today?" listed #20 |
| User B connects an external MCP client with only the gateway URL and a key | 3 | Inspector `tools/list`: 15 tools of 3 servers; `woo__list_orders` returned #20 |
| A two-server task from a client | 3 | Chat as B: `woo__list_orders` + `notes__create_note`, both success; Claude Code: owner's live step |
| Revoking a key cuts access | 4 | Revoke 204; next call HTTP 401 |
| Disabling a server removes its tools for the external client and the chat | 4 | `tools/list` 15 to 10 to 15; chat made no `notes__*` call |
| A dead server does not break the others and recovers | 4 | `utils` unreachable at 3.7 s; `woo__list_products` OK; connected at 19.9 s |
| Every action is audited with user, source, server, tool, outcome | 5 | Rows 110 to 125 above |

## Clean up (optional)

- Delete **Demo Lamp** (product 19) and the demo orders (#20; #15 is an older smoke order) in wp-admin; the generated customers (`smoke+...@example.com`) stay in **Users**.
- Delete the demo notes with `notes__delete_note` (they live in memory only and vanish with the pod).
- Disable the two `demo-b-...` users on the **Team** page if you do not need them. Their passwords were generated and discarded, so they cannot log in again: invite a fresh member for your video.
- `Remove-Item Env:UGW_KEY`.
