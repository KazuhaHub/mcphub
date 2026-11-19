# Architecture and data/auth invariants

Read this guide when changing runtime wiring, MCP connections, HTTP routing, authentication, persistence, or database behavior. For the public runtime overview, see [docs/development/architecture.mdx](../development/architecture.mdx).

## Runtime map

- `src/index.ts` starts the process and `src/server.ts` owns `AppServer` initialization, route registration, and shutdown.
- `src/services/mcpService.ts` wires upstream clients and MCP request handlers. `mcpConnectionLifecycle.ts` manages runtime shutdown and on-demand wake/idle transitions; `mcpStdioLifecycle.ts` owns process-tree termination and draining. `mcpTools.ts`, `mcpPrompts.ts`, and `mcpResources.ts` handle tool, prompt, and resource requests. Authorization wrappers stay in `mcpService.ts`; `mcpRequestScope.ts` bounds request-local server projections.
- `src/routes/` defines HTTP routes; `src/controllers/` implements resource handlers.
- `src/dao/` provides file-backed persistence by default; `src/db/` provides the optional TypeORM/PostgreSQL backend.
- `src/clients/` contains upstream MCP client wrappers.
- `src/types/` contains shared configuration and domain types.
- `frontend/src/` contains the Vite/React dashboard.

## Persistence changes

When adding or changing a persisted field, update every applicable layer:

1. `src/types/index.ts` — shared interface or schema.
2. `src/dao/*Dao.ts` — JSON implementation when behavior changes.
3. `src/db/entities/*.ts` — TypeORM column; mark optional fields `nullable` and use `simple-json` for object values.
4. `src/dao/*DaoDbImpl.ts` — database create/update mapping.
5. `src/db/repositories/*.ts` — repository wrapper, when it exposes the field.
6. `src/utils/migration.ts` — JSON-to-database migration.
7. `mcp_settings.json` — example configuration, when user-facing.

Database mode is selected at startup by the code in `src/dao/DaoFactory.ts`: `USE_DB=true` enables it; when `USE_DB` is unset, a configured `DB_URL` enables it; an explicit `USE_DB=false` disables it.

Multi-replica mode is explicit (`MCPHUB_REPLICA_MODE=true`). Run `pnpm db:setup` once before serving with `DB_SYNCHRONIZE=false`; `src/db/replicaSchema.ts` tracks configuration writes transactionally, and `src/services/replicaService.ts` reconciles them every five seconds. Configuration API handlers use a request-scoped database transaction; preserve that scope when adding DAO access. Sessions and application workflow state remain local. See [replica deployment](../configuration/replicas.mdx) for the supported boundaries and `pnpm test:replicas` for disposable Docker verification.

Personal credential import is independent of user seeding. Validate source and destination ciphertext with the existing runtime key before importing, and commit bindings with their internal `credential_binding_imports` receipts in one transaction. Receipts must survive binding deletion to prevent retained source files from restoring revoked credentials; keep them out of configuration exports.

## File staging

Optional staged-file handoff for stdio servers (#1056). Modules live in `src/services/fileStaging/`: `adapter.ts` (pinned SSH profile, resolved-argv allowlist, per-principal cwd), `identity.ts` (owner hash), `rewrite.ts` (`mcpfile://` planning), `policy.ts` (shared lease/finalize decisions), `dispatch.ts` (the seam), `settings.ts` (master switch and store selection), `stateStore.ts` / `dbStateStore.ts` (ledgers), `tools.ts` (hub tools), `paths.ts` (layout and symlink-safe IO), `processLock.ts`. Configuration validation is in `src/utils/fileStagingConfig.ts`, the download handler is `src/controllers/fileStagingController.ts`, the staging PATCH routes are in `src/routes/serverRoutes.ts`, and virtual-tool injection plus dispatch are in `src/services/mcpService.ts`.

`dispatchStagedToolCall()` is the single rewrite/lease/finalize seam, called from `callToolWithReconnect` so direct calls and `$smart call_tool` share it. Hidden-argument removal happens inside the wrapped per-call path, so a parameter declared for staging must also be rejected from `hiddenParams` at config validation. The order is security-relevant: re-read the config, validate the adapter/stable server id/pinned version, plan exact references, pin inputs and lease every output, rewrite only declared parameters, invoke, then finalize or fail the outputs. Pins are released in `finally`; do not add a second rewrite path.

There are two ledger backends selected once in `settings.ts`: file mode (`FileStagingStateStore`, `data/staging-state/refs.json` plus a lock) and database mode (`DbStagingStateStore`, `file_staging_refs` / `file_staging_tokens`). Both implement `StagingStateStore` and share the decisions in `policy.ts`; keep lease/finalize rules there rather than duplicating them. With `DB_SYNCHRONIZE=false`, the schema comes from `docs/migrations/0006-file-staging.sql`.

`processLock.ts` enforces one writer per state directory through `staging.lock` (30-second mtime heartbeat, takeover only after 120 seconds stale); initialization runs at startup when the master switch is on (otherwise on first use) and releases the lock when init fails. `resolveStagingCwd()` moves the child cwd to the principal root for any server with a staged tool, so a `fileStaging` toggle must remain connection-relevant in `src/utils/connectionRelevantConfig.ts`. The `mcphub_file_` prefix is reserved: the hub definition wins over an upstream tool and must never fall through to upstream dispatch. Download links are minted only from a configured non-localhost base URL (`src/utils/installBaseUrl.ts`).

## Bearer-key invariant

Bearer keys have explicit kinds. Legacy and operator-created keys use `kind: 'system'`; user-level keys use `kind: 'user'` and must have an `owner`. Do not infer the kind from whether `owner` is empty. Personal keys support `all` or `groups` scope; allowed-group scope must intersect with the owner's permissions and must not allow global or direct-server routes. User-level keys restore the owner's live user context on MCP transport requests and are not dashboard API credentials.

Bearer-key tokens are never stored: `BearerKey` holds `tokenHash` (SHA-256, constant-time compared) and a display `tokenPrefix`. `token` exists only on the object `create()` returns, which is the one response that shows it. DAOs hash a plaintext `token` they are given, JSON reads and `migrateLegacyTokens()` (run at startup) hash plaintext left by older versions in place, and settings exports and key lists omit the token and the hash. Authentication compares `tokenHash` through `bearerHashMatches`; never compare or log `token`. See [ADR 0012](../adr/0012-security-hardening.md).

## Logging and redaction

Anything that can reach a log line, an activity row or an error message goes through `src/utils/redaction.ts` (URLs, headers, env, args, bodies) or the logger, which applies it by key name (`url`, `headers`, `env`, `args`) and to error objects. A resolved credential slot is registered in `resolvedCredentialValues`; `collectConfigSecrets(config)` lists every value to scrub for that runtime. A new place that logs a URL, a request, a child-process argument or an upstream response must use these helpers. `routing.allowTokenInQuery=false` rejects query-string credentials on MCP, SSE and `/api` routes.

## The credential-write scope stays narrow

A token whose scope contains `credentials:write:*` is honoured only by the `/api` gate in `src/middlewares/auth.ts`, only for `PUT`/`DELETE /credentials/<its server>`, and as a non-admin principal carrying `credentialWriteGrant`. `resolveOAuthGrantFromToken` must keep refusing it, so it never authenticates an MCP route. Never read the user's admin status when serving it, never accept it beside another scope, and re-check the client against the server's `credentialWriteClients` on every request. See [ADR 0013](../adr/0013-credential-write-scope.md).

## External-resource tokens are not MCPHub bearers

A token issued for a configured external resource (`oauthServer.externalResources`) is a signed JWT for another audience; its stored record keeps an undisclosed internal id and a `resource`. `resolveOAuthGrantFromToken`, the credential-write resolver and the `getAccessToken` model hook must keep refusing JWT-shaped values and any record with a `resource`, so such a token never authenticates an MCP route or an API. The `resource` request parameter is classified once by `classifyResource` (exact match, own origin, else `invalid_target`), a grant stays bound to its resource across refresh, and signing-key material (`oauth_signing_keys`, the `.oauth-signing-keys.json` sidecar) stays out of every API, export and log. See [ADR 0014](../adr/0014-external-resource-tokens.md).

A personal-OAuth server whose `url` is an external resource of this hub (`resolveSelfResource`) uses MCPHub's own public client and an issuer pinned to itself; its metadata and token calls go through `createSelfIssuerFetch` (loopback listener on the same app), never the public URL, and disconnecting revokes the grant on the authorization server too. Every personal OAuth flow is bound to the starting browser (cookie nonce, `src/utils/oauthFlowBinding.ts`) and owner; keep `completePersonalOAuth` refusing a callback without that proof. The consent page is skipped for that client only when the entry opts in with `skipConsentForPersonalConnection` (`isConsentSkippedForSelfClient`); keep that check exact (client id, callback, scopes) and logged. See [ADR 0015](../adr/0015-self-issued-personal-oauth.md).

## Personal credentials follow their destination

A credential-slot binding stores `destinationFingerprint` (see `src/utils/credentialDestination.ts` for the exact field list). A binding whose fingerprint differs from the current declaration must never be injected: `resolveCredentialBinding` throws `StaleCredentialError` (a `MissingCredentialError`) before reading any value. Any new `ServerConfig` option that changes where traffic goes (a proxy, TLS or agent option, a working directory) belongs in that list. The binding functions take the stored definition and expand it themselves, once, through `expandServerConfig` (never skip it, never pass an already expanded or resolved config); startup runs `stampLegacyBindings`, and a binding without a fingerprint is stale. Applies with Workspace Mode off too; see [ADR 0011](../adr/0011-credential-destination-binding.md).

## Service readiness probes carry a user's credential

`src/services/serviceReadinessService.ts` sends a user's personal bearer (OAuth access token or one credential slot) to the administrator-set `readiness.url`; the contract is in [Service Readiness](../features/service-readiness.mdx). Keep it narrow: the bearer comes only from `resolveReadinessBearer` (the personal OAuth provider or `resolveCredentialBinding`, never a second secret path), the request goes through `createRedirectValidatingFetch` with `allowInternal` false and zero redirect hops, and nothing that could carry the bearer (headers, error text, URLs) reaches a log. `readiness` is administrator-only on every write path (`readinessRefusal` in `serverController.ts`, template import) and is withheld from the shared-user server view. The workspace list must never wait on or fail because of a probe: use `getServiceReadinessBounded`.

## MCP resource-server challenges

`src/utils/bearerChallenge.ts` builds every `WWW-Authenticate: Bearer` value for MCP/SSE routes (`sendBearerAuthError` in `sseService.ts`, `sseUserContextMiddleware`). A request with no credentials gets `resource_metadata` and `scope` and no `error` code (RFC 6750 3.1); an invalid token adds `error="invalid_token"`. `scope` and the protected resource metadata's `scopes_supported` both come from `getResourceScopes`: `oauthServer.allowedScopes` minus `offline_access` and `credentials:write:*`. MCP routes enforce no scope today, so there is no `insufficient_scope` path; if one is added, build its 403 with the same helper. The owner-mismatch 403 deliberately has no challenge.

## Routing surface

- `/mcp/{group|server}` routes to a group, server, or `$smart`. `SMART_ROUTING_PATH` adds a reserved alias for `$smart`; transport middleware normalizes the alias before authentication while preserving the original OAuth resource URL.
- `/:user/mcp/{group|server}` and `/:user/sse/{group}` are user-scoped variants.
- `AppServer.initialize()` in `src/server.ts` is the route-registration entry point.
- Authentication spans dashboard JWT/bcrypt, passkeys, bearer keys, MCPHub's OAuth authorization server, and optional Better Auth. Inspect the current middleware and route code before changing auth behavior.
- Better Auth `loginMode` is presentation only; `disablePasswordLogin` stays the enforcement switch. The server publishes the effective mode (`dual` without a mounted provider, `sso_first` instead of `sso_redirect` with several), and the redirect guards (`?local`, `?error`, the five-minute cross-tab logout mark, cancel, two-minute per-tab cooldown, storage fail-safe) live in `frontend/src/utils/loginPresentation.ts`; do not add an auto-redirect path that bypasses them. Every post-login or SSO callback target goes through `frontend/src/utils/safeReturnUrl.ts` (`sanitizeReturnUrl` on the raw value, `isSafeRelativeUrl` again on the final string, the same rule as Better Auth's `isSafeRelativeURL`); dot segments and own-origin absolute URLs can normalise to `//host`, so never follow a target that skipped it. Every password check goes through `getPasswordLoginPolicy()` (`all`/`admins`/`none`); under `admins` (break-glass `adminPasswordLogin`) any refusal must stay byte- and work-identical to the `none` answer, and the policy must never reach the public config.
- Passkeys (`src/services/passkeyService.ts`) are a local-account credential: they follow `disablePasswordLogin`, are stored like OAuth approvals (`PasskeyDao` sidecar file or `user_passkeys`), and their two public sign-in routes are listed in `isApiAuthExemptPath`. Each passkey keeps the RP ID it was created under and is accepted only there, and is bound to the owner's session version like OAuth approvals, so a password change or account recreation revokes it. Sign-in usage is written update-only (`recordUse`) with the counter check in the same write (`isCounterAdvance`; a conditional `UPDATE` in database mode), so a removed passkey is never recreated and a racing sign-in cannot move the counter backwards; replica mode records spent challenges in `oauth_state`.

## Declarative database configuration

`MCPHUB_SETTINGS_SYNC=upsert|prune` reconciles server/group declarations at startup only; see `src/utils/settingsSync.ts`. Keep runtime authentication state outside reconciliation. Internal sync ownership markers and the server declaration fingerprint must stay out of public DAO mappings and settings exports; unchanged declarations retain upstream OAuth state, while changes invalidate it. Pruning deletes only managed entries in explicitly supplied collections, with associated cleanup in the same transaction.
