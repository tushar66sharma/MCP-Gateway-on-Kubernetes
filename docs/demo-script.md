# Definition-of-done demo script

This is the walk-through that shows the whole platform working, in the order of the assignment's definition of done: **Store, Chat agent as user A, External MCP client as user B, Team and control, Audit**. Every step has the command or click, the expected result and what was observed.

**What was run (2026-10-23, local k3d cluster `k3d-urumi`).** The whole script was executed live at **API level** with a scratch Node script (not committed): login, chat, invite, accept, keys, server disable and enable, audit, plus the real **MCP Inspector CLI** (`@modelcontextprotocol/inspector@2.11.0`) for the external client and `kubectl` for the pod kill. Steps that are verified only this way say "(verified via API; click-through not run)": the dashboard pages call the same API, but nobody clicked through this exact script in a browser. An external LLM client (Claude Code or Cursor) is not run here: it is the owner's step, marked as such.

Two people: **user A** is the administrator (`admin@example.com`); **user B** is a fresh invited member (`demo-b-<timestamp>@example.com`). Nothing here prints a password, key or invite link; secrets go into variables only.

Run everything from the repository root in Windows PowerShell 5.1.

## 0. Before you start

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\up.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\smoke-test.ps1 -Quick
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\get-secret.ps1 -Namespace gateway -Name gateway-bootstrap -Key password   # copies the admin password to the clipboard
```

The chat steps spend the free-tier LLM quota (about 3,000 to 5,500 tokens per turn, observed). Each user's chat budget is 50,000 tokens a day (`gateway.chat.dailyTokenBudget`), and the five turns of this run cost about 15,000 to 18,000 in total (the failed turn's usage is not reported). On a recording day check the Chat page's `Today: used / limit` line first; it resets at 00:00 in the store's time zone.

**Before recording (owner): dry-run one external LLM client.** No LLM client has ever connected to this gateway; only MCP Inspector has, and Inspector cannot run a prompt. The definition-of-done bullet "Run one prompt that needs tools from two different upstream servers" is shown with an external client, so test that path once before the camera is on.

1. Install ONE LLM MCP client you can run: the **Claude Code** CLI (`irm https://claude.ai/install.ps1 | iex`; needs a Claude subscription or a Console account) or **Cursor** (free tier).
2. Invite a fresh member (Team > Invite), accept the invite and create that member's API key (as in section 3). Connect the client as that member with the gateway URL `http://app.localhost/mcp` and the member's key: Claude Code through the `.mcp.json` + `URUMI_GATEWAY_KEY` route ([Connect Claude Code](run-guide.md#connect-claude-code)) or Cursor's MCP settings ([Connect Cursor](run-guide.md#connect-cursor-not-tested)). Do not paste the key into the chat or a file you commit.
3. Check `tools/list`: it must show **15 tools**. Then send the two-server prompt once: `Show today's orders and save a note listing their numbers`.
4. Expected (not tested): the client calls `woo__list_orders` and `notes__create_note`, and the Audit log shows both attributed to that member with source `mcp`.

**Fallback, if neither client is available:** show the two-server task in the dashboard chat as user B (run and verified on 2026-10-23, section 3). Also show MCP Inspector `tools/list` and one tool call from each server as user B, and say out loud that the external-client prompt is not shown.

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
- **External LLM client: owner's step, not yet run** (no `claude` CLI on the owner's machine; Cursor not tested). Use the dry run in section 0 first: the same prompt in **Claude Code** through the `.mcp.json` + `URUMI_GATEWAY_KEY` route from [Connect Claude Code](run-guide.md#connect-claude-code), or in Cursor. Expected (not tested): `/mcp` lists `urumi-gateway` as connected; the prompt calls `woo__list_orders` and `notes__create_note` as user B. If no client is available, use the fallback in section 0. `URUMI_GATEWAY_KEY` (Claude Code's `.mcp.json`) and `UGW_KEY` (the Inspector commands here) are just two environment variable names for the same key.

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

## 6. Traceability: the assignment's definition of done to this script

The left column quotes the assignment's "Definition of done" (page 3) word for word. "Evidence" says how strong the proof is: **observed** (a value seen on the live run), **inferred**, or **owner's live step**.

| Definition of done (verbatim) | Demo step | Evidence |
|---|---|---|
| Store: "Open the storefront, add a product to the cart and check out with a test-friendly method (COD or a dummy gateway is fine)." | 1 | Observed via the Store API with COD: order #20 (`customer-order-smoke.ps1`); browser click-through not run |
| Store: "Confirm the order is visible in WooCommerce admin." | 1 | Not click-verified in wp-admin. The order was read back through the gateway (`woo__list_orders`, status `processing`); open **WooCommerce > Orders** in the video |
| Chat agent, as user A: "Ask the agent to create a product with a name and price. The product appears on the storefront." | 2 | Observed: product 19 `publish`; `GET /product/demo-lamp/` HTTP 200 with the name |
| Chat agent, as user A: "Place an order for it on the storefront by hand, then ask the agent what orders came in today. It returns that order." | 2 | Order placed by script (`customer-order-smoke.ps1 -ProductId 19`); by hand in the video. Observed: the chat listed #20 |
| External MCP client, as user B: "Connect Claude Code, Cursor or MCP Inspector to the gateway using only the gateway URL and user B's API key." | 3 | Observed with MCP Inspector (URL and key only); an external LLM client (Claude Code or Cursor) is the owner's step, not yet run |
| External MCP client, as user B: "See the tools of every enabled server, ..." | 3 | Observed: `tools/list` returned 15 tools of 3 servers |
| External MCP client, as user B: "... and ask the same orders question successfully." | 3 | Observed: `woo__list_orders period=today` returned #20 |
| External MCP client, as user B: "Run one prompt that needs tools from two different upstream servers." | 3 | Observed through the chat as user B (`woo__list_orders` + `notes__create_note`); in an external LLM client it is the owner's step, **not yet run** (dry run in section 0; fallback stated there) |
| Team and control: "Revoke user B's key. Their next call is rejected." | 4 | Observed: revoke 204, next call HTTP 401 |
| Team and control: "Disable one upstream server. Its tools disappear from both the chat agent and the external client." | 4 | External client observed (`tools/list` 15 to 10 to 15). Chat agent: inferred (no `notes__*` tool call; generic scope refusal), not a clear "notes is disabled" answer; show the chat failing to save a note in the video |
| Team and control: "Kill the pod of one upstream server. The other servers keep working, and the dashboard shows the dead one as unreachable." | 4 | Observed: `woo__list_products` HTTP 200 meanwhile; `utils` `unreachable` at 3.7 s, connected at 19.9 s (dashboard view not click-verified; status via API) |
| Team and control: "Every call above appears in the audit log, attributed to the right user." | 5 | Observed: rows 110 to 125 above, right user and source |

## Clean up (optional)

- Delete **Demo Lamp** (product 19) and the demo orders (#20; #15 is an older smoke order) in wp-admin; the generated customers (`smoke+...@example.com`) stay in **Users**.
- Delete the demo notes with `notes__delete_note` (they live in memory only and vanish with the pod).
- Disable the two `demo-b-...` users on the **Team** page if you do not need them. Their passwords were generated and discarded, so they cannot log in again: invite a fresh member for your video.
- `Remove-Item Env:UGW_KEY`.
