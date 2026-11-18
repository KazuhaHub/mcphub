# Client compatibility harness

Runs the full MCP OAuth flow from real client stacks against a throwaway MCPHub and records pass or
fail per step. It exists to answer "does client X still work with this MCPHub?" without a person
clicking through a consent screen, and to tell an MCPHub defect from a client limitation.

It is a manual acceptance tool, not part of `pnpm test` or CI: it spawns the real server, needs
network for the one-time installs, and the Python runners need a Python environment.

## What is covered

Every runner performs the same five steps against the hub's `/mcp` endpoint:

| step | what is checked |
| --- | --- |
| 1 discovery | the client got through the `401`, PRM and AS metadata to the authorization endpoint; which well-known documents it fetched is read from the wire and noted (a client that skips PRM still passes, with a note). The `401` challenge, PRM and AS metadata are checked in detail by the raw-http probe row |
| 2a register | client identification: Dynamic Client Registration (DCR) or Client ID Metadata Document (CIMD) |
| 2b login | authorization code, user login and consent, code exchange. The PKCE method, `resource` indicator, `iss` and `state` the client sent are recorded in the cell (MCPHub itself refuses public clients without `S256`) |
| 3 list | `tools/list` with the issued access token |
| 4 call | `tools/call` on the upstream test tool |
| 5 refresh | wait past the access token lifetime (6 s by default), call again. Passes only if the call works, the token changed, a `refresh_token` grant was answered `200` on the wire, and the user was not sent through consent a second time |

The last column of the matrix is the negotiated MCP protocol version: `2026-07-28` (per-request
`_meta` and `MCP-Protocol-Version`, discovered with `server/discover`) or `2025-11-25` (`initialize`
handshake). It is read from the client where it exposes it and from the wire otherwise.

| runner | stack | notes |
| --- | --- | --- |
| `ts-sdk` | `@modelcontextprotocol/client` with its `OAuthClientProvider`. This is the repo's own dependency, so it is the version the repo pins **with the repo's pnpm patch applied** (`patches/@modelcontextprotocol__client@2.1.0.patch`), not necessarily the stock release | the reference TypeScript client; other TypeScript clients differ in their provider code, not in the protocol. Variants: `dcr-legacy`, `dcr-auto` (version negotiation on, reaches `2026-07-28`), `cimd-legacy`, `cimdforced-legacy` |
| `ai-sdk` | `@ai-sdk/mcp` `createMCPClient` with its own OAuth implementation (`auth`, `OAuthClientProvider`); the tool call goes through `client.tools()` and `tool.execute()`, which is what `generateText` invokes | the MCP client is the separate package `@ai-sdk/mcp`, which has its own OAuth code, not the MCP SDK's; `ai` does not export it |
| `inspector-cli` | `@modelcontextprotocol/inspector --cli` | one invocation per MCP method, sharing the CLI's stored OAuth state. The web Inspector and Claude Code are not driven by this harness |
| `py-sdk` | `mcp` on PyPI, `OAuthClientProvider` over httpx (mcp 1.x) or httpx2 (mcp 2.x, installed by `mcp` itself) | what the OpenAI Agents SDK and langchain-mcp-adapters sit on |
| `openai-agents` | `openai-agents` `MCPServerStreamableHttp`, list and call only, no model call | accepts an httpx `auth` handler (`agents/mcp/server.py`, `MCPServerStreamableHttpParams.auth`), so the SDK's `OAuthClientProvider` does the OAuth |
| `langchain-mcp-adapters` | `MultiServerMCPClient`, list and call only, no model call | accepts an httpx `auth` handler (`langchain_mcp_adapters/sessions.py`, `StreamableHttpConnection.auth`); opens a new MCP session per tool call |

Registration variants: `dcr` is the client's normal behaviour. `cimd` passes the client's CIMD
option and only uses it if the authorization server advertises `client_id_metadata_document_supported`
(the TypeScript SDK, the Python SDK and the Inspector gate on that; `@ai-sdk/mcp` has no CIMD option, so it only has `dcr` and `cimdforced`). `cimdforced` supplies the CIMD URL as pre-registered client information,
which bypasses the advertisement gate and so tests MCPHub's CIMD handling on its own.

There is also a client independent **raw-http probe** row: it checks the 401 challenge, PRM, and every
AS metadata location (RFC 8414, OIDC), and reports which gaps are known to be fixed by in-flight
branches. `node scripts/compat/probe.mjs https://hub.example.com/mcp` runs just that probe against any
hub; it logs in to nothing.

### How the browser step is automated

The hub's SPA consent page (`frontend/src/pages/OAuthConsentPage.tsx`) uses the dashboard session
token for two calls: `GET /oauth/authorize?...` with `x-auth-token` and `Accept: application/json`,
then `POST /oauth/authorize` (form body, `allow=true`) with the same header, and follows the returned
`{ redirect }`. `lib/browser.mjs` makes those two calls as the test user, after a normal
`POST /api/auth/login`, and hands the redirect back to the client. Server-side authentication is not
relaxed in any way. Clients in other processes reach it over a loopback endpoint guarded by a random
per-run secret.

### What the harness runs

- the real MCPHub (`tsx src/index.ts`) on a free port, a temp settings directory, one admin user
  whose password (like the JWT secret) is generated fresh for each run, the hub listening on `127.0.0.1` only, OAuth server enabled with `accessTokenLifetime` 6 s,
  DCR enabled, CIMD enabled;
- an in-process upstream MCP server with one `echo` tool (no `npx`, no network);
- a recording proxy between clients and the hub, so the matrix is checked against what was on the wire:
  a `refresh` pass needs a successful `refresh_token` grant, a DCR pass needs a `POST /oauth/register`,
  discovery details list the well-known documents the client fetched, and the protocol column falls
  back to the observed `initialize` or `_meta` version.

CIMD uses a fake `https://client.compat.test/...` client_id. MCPHub's SSRF guard (correctly) refuses
loopback hosts, so the hub process is started with `lib/hub-preload.mjs`, which uses the two test seams
MCPHub already exports for this (`setCimdFetchImplForTesting`, `setCimdDnsLookupForTesting`) to serve the
document. Everything after the document fetch is MCPHub's real code. That preload is only loaded into the
throwaway hub process.

## How to run

One-time setup (nothing is installed globally and nothing is added to the repo's `package.json`; the package managers still write their usual caches under your home directory):

```sh
export PATH="/opt/homebrew/bin:$PATH"   # if node/npm are not on PATH in your shell

# Node runners: pinned in scripts/compat/package.json, installs into scripts/compat/node_modules (gitignored)
npm install --prefix scripts/compat

# Python runners (optional): two venvs, because langchain-mcp-adapters needs mcp<2 and cannot share one with mcp 2.x
python3 -m venv /tmp/compat-venv      && /tmp/compat-venv/bin/pip install -r scripts/compat/runners/requirements.txt
python3 -m venv /tmp/compat-venv-mcp2 && /tmp/compat-venv-mcp2/bin/pip install -r scripts/compat/runners/requirements-mcp2.txt
```

Run everything:

```sh
node scripts/compat/run.mjs \
  --python /tmp/compat-venv/bin/python --python-mcp2 /tmp/compat-venv-mcp2/bin/python \
  --out /tmp/compat-results.json
# or: pnpm compat --out /tmp/compat-results.json
```

Options: `--only <substring>` (repeatable, matches runner ids; `--list` prints them), `--lifetime <sec>`,
`--keep` (keep the temp dir with `hub.log`), `--hub-root <dir>` (run the hub from another checkout, for
example a worktree of an in-flight branch with its own `node_modules`). Without `--python` the Python
runners are skipped and shown as `n/a`. The exit code is 1 if any step failed.

Re-render a saved result: `node scripts/compat/report.mjs /tmp/compat-results.json`.
A full run takes a few minutes: each row waits for the 6 s access token to expire.

### Reading the matrix

`PASS`, `FAIL [cause]`, `skip` (an earlier step failed), `n/a` (not run). Causes, assigned by
`lib/known-gaps.mjs` (anything it does not recognise is shown as `[?]` so it is never silently
misfiled): `[G]` expected on main, fixed by an in-flight branch; `[B]` an MCPHub defect with no branch
in flight; `[C]` client limitation; `[H]` harness limitation.

## Last observed results

main at `2f5f0bd7`, access token lifetime 6 s, versions as pinned in `package.json` and the requirements files
(`@modelcontextprotocol/client` 2.1.0, `@ai-sdk/mcp` 2.0.101, `ai` 7.0.176, `@modelcontextprotocol/inspector` 2.16.0,
`mcp` 1.30.0 and 2.3.0, `openai-agents` 0.25.0, `langchain-mcp-adapters` 0.3.2).

- Every client passes all five steps with DCR, including the automatic refresh after expiry. The `2026-07-28` protocol
  is negotiated by `ts-sdk` with version negotiation on, `ai-sdk`, `py-sdk` on mcp 2.x and `openai-agents` on mcp 2.x; the
  mcp 1.x line, `inspector-cli`, `langchain-mcp-adapters` and `ts-sdk` with default options use the `2025-11-25` handshake.
- All CIMD rows fail on main, and every failure is a gap closed by the in-flight CIMD branch: the AS metadata does not
  advertise `client_id_metadata_document_supported` (so no SDK even tries CIMD), and a code issued to a CIMD client cannot be
  redeemed because `oauthServerService` looks the client up with `findOAuthClientById` only. Run against that branch
  (`feat/cimd-discovery-and-validation` at `d7804016`) with `--hub-root`, all eleven CIMD rows (`ts-sdk`, `ai-sdk`,
  `inspector-cli`, `py-sdk` on both mcp lines) pass all five steps. The discovery branch (`3e056e1a`) and the
  WWW-Authenticate branch (`f37cbf87`) were also run with the DCR rows of `ts-sdk` and `inspector-cli`: no regression.
- The raw probe on main fails three checks, all with in-flight branches: no `client_id_metadata_document_supported`,
  no `authorization_response_iss_parameter_supported`, and no OIDC discovery document. On the discovery branch the `iss`
  flag is present but `/.well-known/openid-configuration` is still `404` for this path-less issuer; decide whether that is
  intended (RFC 8414 clients do not need it, OIDC-only clients do).

## Settings the harness needs, and one sharp edge

The harness writes a **complete** `oauthServer` block. With a partial block (for example only `enabled` and
`accessTokenLifetime`) the AS metadata endpoint merges defaults and advertises `registration_endpoint`, but
`POST /oauth/register` reads the raw block and answers `403 Dynamic client registration is not enabled`
(`oauthDynamicRegistrationController.ts` does not merge `cloneDefaultOAuthServerConfig()`). Clients then fail at
registration after a successful discovery. It does not affect installs whose block is complete.

## What cannot be automated, and how to test it by hand

These clients need a public HTTPS URL (and an account), so they cannot run headlessly against a
throwaway local hub.

**Caveat on the vendor-specific details below.** The menu paths, callback URLs, header names and request
shapes of Claude, ChatGPT, Cursor, VS Code, the Anthropic API and the OpenAI API are written from general
knowledge of their public documentation and were **not verified from this repository or in this session**.
Vendors change them often. Treat them as a starting point and check the vendor's current documentation; the
authoritative redirect URI for any client is the one it actually registers, which the hub's OAuth clients
page and the `POST /oauth/register` request show. What to look for on the MCPHub side (the five steps)
does not depend on those details.

Before any of them, run the probe against your public URL:

```sh
node scripts/compat/probe.mjs https://hub.example.com/mcp
```

For every manual test below, use the **global MCP endpoint `https://<public-host>/mcp`** (or a group
endpoint `https://<public-host>/mcp/<group>`), with the hub's public base URL configured
(`install.baseUrl` or `INSTALL_BASE_URL`) so `issuer`, `resource` and the `WWW-Authenticate` URL are
the public HTTPS address, not an internal one. Set the OAuth access token lifetime to something short
(Settings, OAuth server, access token lifetime: 60 s is enough) for step 5 and restore it afterwards.
Keep a terminal on the hub's request log (or reverse proxy access log) to watch the sequence.

What to look for, in every client, at each of the five steps:

1. **Discovery.** The log shows `POST /mcp` answered `401`, then `GET /.well-known/oauth-protected-resource/mcp`,
   then `GET /.well-known/oauth-authorization-server` (some clients also try `/.well-known/openid-configuration`;
   a `404` there is expected on main until the discovery branch lands). The client must not stop here with a generic
   "cannot connect".
2. **OAuth login.** The client registers (`POST /oauth/register`, or uses a CIMD URL as `client_id`), the browser opens
   `/oauth/authorize?...&code_challenge_method=S256&resource=https://<public-host>/mcp`, the consent page names the right
   client and resource, you sign in and press Allow, and the client reports connected. In the dashboard OAuth clients page,
   note the `redirect_uris` the client registered. A `redirect_uri` mismatch, `invalid_target` or `invalid_client` here is
   the usual failure.
3. **List tools.** The tools of the servers the token may see appear in the client. An empty list with a connected client
   means the token's user or group scope is wrong, not the OAuth flow.
4. **Call a tool.** Ask the client to call a harmless tool (for example a time or echo tool) and confirm the answer.
5. **Expiry and refresh.** Wait longer than the access token lifetime without touching the connection, then call a tool
   again. Pass means: the log shows one `POST /oauth/token` with `grant_type=refresh_token` answered `200` and the
   call works with no consent screen. Fail means: a second login prompt, or the client shows "reconnect/authentication
   required".

Also record which protocol version the client used: in the request log, `initialize` with `protocolVersion` is
`2025-11-25`; `server/discover` or an `MCP-Protocol-Version: 2026-07-28` header is the new era.

### Claude Desktop and claude.ai (custom connector)

- URL to enter: `https://<public-host>/mcp`. Settings, Connectors, Add custom connector, paste the URL, leave
  client id and secret empty (it uses DCR, or CIMD if advertised). Claude's callback is on `claude.ai`
  (reported as `https://claude.ai/api/mcp/auth_callback`; confirm it among the registered `redirect_uris`).
- Steps 1 and 2 happen when you press Connect on the connector. Step 3: open a chat, enable the connector,
  and check the tool list under the connector. Step 4: ask Claude to use one of the tools. Step 5: leave the chat
  idle past the token lifetime, then ask for the tool again.
- Claude Desktop (local app) uses the same connector entry through your claude.ai account; remote connectors are
  added in the same Connectors settings, not in `claude_desktop_config.json`.

### ChatGPT (connector, developer mode)

- URL to enter: `https://<public-host>/mcp`. Settings, Connectors, Advanced, Developer mode on, then Create:
  name, MCP server URL, Authentication: OAuth. ChatGPT registers dynamically; its callback is on
  `https://chatgpt.com/` (the exact path is shown in the registration request, so read it from the dashboard).
- Step 3: in a new chat, add the connector from the composer's tools menu and confirm the tool list. Step 4: ask for
  a tool call (it asks you to confirm write tools). Step 5: idle past the token lifetime and call again. If it
  asks you to re-authenticate, ChatGPT did not refresh.

### Cursor

- Add to `~/.cursor/mcp.json` (or Settings, MCP, Add): `{ "mcpServers": { "hub": { "url": "https://<public-host>/mcp" } } }`.
  Cursor shows "Needs login" and opens the browser; its callback is a `cursor://` deep link, so check the
  registered `redirect_uris` include it.
- Step 3: the server turns green and lists tools. Step 4: ask the agent to call one. Step 5: idle, call again;
  a "Needs login" state after expiry means no refresh.

### VS Code (MCP servers)

- Command palette, "MCP: Add Server", HTTP, `https://<public-host>/mcp`. It does DCR; its redirects are
  `http://127.0.0.1:<port>` and `https://vscode.dev/redirect`, so loopback redirect matching on the hub matters.
  Accept the "Dynamic Client Registration not supported" prompt only if you see it: that means discovery step 1/2
  did not find `registration_endpoint`.
- Step 3: "MCP: List Servers" shows tools; step 4: use the tool in Copilot Chat agent mode; step 5: idle, call again.

### Anthropic API, MCP connector (Messages API `mcp_servers`)

- There is no OAuth flow in this API: you pass a ready access token. `mcp_servers: [{ "type": "url", "url":
  "https://<public-host>/mcp", "name": "hub", "authorization_token": "<access token>" }]` plus the MCP connector
  beta header and tool declaration from Anthropic's current documentation.
- Steps 1 and 2 are therefore yours: obtain a token with any OAuth client (for example MCP Inspector's web UI or CLI against
  the public URL; the harness itself only drives its own throwaway hub), or use a hub bearer key. Step 3 and 4: the response contains `mcp_tool_use` and
  `mcp_tool_result` blocks; a `401` from the hub should surface as an error result (confirm how in the current docs). Step 5: send the same
  request with an expired token and confirm the failure is a clear auth error (the API does not refresh; the caller must).
- Requires an API key and the hub reachable from Anthropic's servers (public HTTPS, not an internal address).

### OpenAI Responses API, remote MCP tool

- Same shape: `tools: [{ "type": "mcp", "server_label": "hub", "server_url": "https://<public-host>/mcp",
  "authorization": "<access token>", "require_approval": "never" }]`. The API lists the tools itself (an
  `mcp_list_tools` item in the output: that is step 3) and calls them (`mcp_call` items: step 4). There is no
  OAuth flow and no refresh: step 5 is "the caller must supply a fresh token", check that an expired token yields a
  clear `401`-derived error rather than a hang.
- Requires an OpenAI API key and a hub reachable from OpenAI's servers.

## Adding a runner

A runner is a script that reads `COMPAT_CTX` (JSON: `mcpUrl`, `browserUrl`, `browserSecret`,
`accessTokenLifetime`, `cimd`) and `COMPAT_VARIANT`, records the six steps (`lib/steps.mjs` for Node,
`runners/compat_common.py` for Python), and prints `@@COMPAT_RESULT@@<json>` as its last output. Register it
in `lib/runners.mjs`. Request the user step with `POST <browserUrl>` `{ "authorizationUrl": "..." }`
(header `x-compat-secret`), which answers `{ "redirect": "<callback URL with code>" }`.

## Layout

- `run.mjs` entry, `lib/main.mjs` orchestration, `lib/hub.mjs` throwaway hub, `lib/proxy.mjs` recording proxy
- `lib/browser.mjs` consent automation, `lib/probe.mjs` discovery probe, `lib/known-gaps.mjs` failure triage
- `report.mjs` matrix formatting (unit tested in `tests/scripts/compat-report.test.ts`), `probe.mjs` standalone probe
- `runners/` one script per client stack, plus `requirements*.txt`
