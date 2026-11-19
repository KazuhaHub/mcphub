import type {
  ReadinessConfig,
  ServerConfig,
  ServiceReadiness,
  ServiceReadinessState,
} from '../types/index.js';
import { MissingCredentialError, resolvedCredentialValues } from '../utils/credentialTemplate.js';
import { logger } from '../utils/logger.js';
import { isSafeHttpsUrl, readinessOriginAllowed } from '../utils/readinessConfig.js';
import { createRedirectValidatingFetch, type FetchLike, type SsrfLookup } from '../utils/ssrf.js';
import { credentialBindingEvents } from './credentialBindingService.js';

/**
 * Service readiness, contract v1 (docs/features/service-readiness.mdx): MCPHub asks a service
 * whether one user's personal setup actually works, instead of assuming a bound credential does.
 * The bearer is the user's own credential and never leaves this module except in the request
 * header, so nothing here logs a request, a header or an error message.
 */

export const READINESS_TIMEOUT_MS = 5_000;
export const READINESS_MAX_BODY_BYTES = 16 * 1024;
export const READINESS_CACHE_TTL_MS = 5 * 60_000;
// A failed check is remembered briefly so a down service is not hit on every list refresh.
export const READINESS_FAILURE_TTL_MS = 30_000;
// Explicit re-checks closer together than this answer from the cache.
export const READINESS_REFRESH_MIN_INTERVAL_MS = 3_000;
// How long a workspace list waits for a probe before showing `unknown`.
export const READINESS_LIST_WAIT_MS = 2_000;
// An expired answer is served while a new probe runs, but not once it is this old.
export const READINESS_MAX_STALE_MS = 60 * 60_000;
// Probes in flight at once, across all users and services; the rest queue.
export const READINESS_MAX_CONCURRENT_PROBES = 16;
const MAX_CACHE_ENTRIES = 2_000;
const MAX_SUMMARY_LENGTH = 200;
const MAX_ACTION_LABEL_LENGTH = 80;

const STATES: readonly ServiceReadinessState[] = [
  'ready',
  'needs_setup',
  'degraded',
  'expiring',
  'expired',
  'revoked',
];

export interface ReadinessDeps {
  // Resolves the user's bearer for the declaration; throws when there is none.
  resolveBearer: (
    user: ReadinessUser,
    serverName: string,
    definition: ServerConfig,
  ) => Promise<string>;
  // The server as connections see it (`${VAR}` placeholders expanded), for the origin rule.
  expandServer: (definition: ServerConfig) => Promise<ServerConfig>;
  // The transport underneath the SSRF guard.
  fetch: FetchLike;
  lookup?: SsrfLookup;
  now: () => number;
  timeoutMs: number;
}

export interface ReadinessUser {
  username: string;
}

export interface ReadinessOptions {
  // Bypass the cache (the dashboard's Re-check).
  refresh?: boolean;
  deps?: Partial<ReadinessDeps>;
}

const unknownResult = (now: number): ServiceReadiness => ({
  state: 'unknown',
  summary: null,
  action: null,
  expiresAt: null,
  checkedAt: new Date(now).toISOString(),
});

// MCPHub's own answer when the service rejects the user's credential: the dashboard words it.
const revokedResult = (now: number): ServiceReadiness => ({
  ...unknownResult(now),
  state: 'revoked',
});

interface CacheEntry {
  value: ServiceReadiness;
  fetchedAt: number;
  expiresAt: number;
  // The declaration the value answers; a changed declaration is a miss.
  key: string;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<ServiceReadiness>>();

// Invalidation counters at the scope an event names, so a probe that began before its own
// user's or service's credential changed cannot cache its answer, and nobody else's is affected.
const generations = {
  global: 0,
  byServer: new Map<string, number>(),
  byUser: new Map<string, number>(),
  byPair: new Map<string, number>(),
};
const generationOf = (username: string, serverName: string): number =>
  generations.global +
  (generations.byServer.get(serverName) ?? 0) +
  (generations.byUser.get(username) ?? 0) +
  (generations.byPair.get(cacheKey(username, serverName)) ?? 0);
const bump = (map: Map<string, number>, key: string): void => {
  map.set(key, (map.get(key) ?? 0) + 1);
};

const cacheKey = (username: string, serverName: string): string =>
  JSON.stringify([username, serverName]);

export const clearReadinessCache = (): void => {
  cache.clear();
  inFlight.clear();
};

// A user changing or removing their credential makes the cached answer stale. Subscribed on
// first use, so importing this module has no side effect.
let subscribed = false;
const ensureSubscribed = (): void => {
  if (subscribed) return;
  subscribed = true;
  credentialBindingEvents.on(
    'invalidate',
    (filter: { serverName?: string; username?: string } | undefined) => {
      if (filter?.serverName && filter.username) {
        bump(generations.byPair, cacheKey(filter.username, filter.serverName));
      } else if (filter?.serverName) bump(generations.byServer, filter.serverName);
      else if (filter?.username) bump(generations.byUser, filter.username);
      else generations.global++;
      for (const key of [...cache.keys()]) {
        const [username, serverName] = JSON.parse(key) as [string, string];
        if (
          (!filter?.serverName || filter.serverName === serverName) &&
          (!filter?.username || filter.username === username)
        ) {
          cache.delete(key);
        }
      }
    },
  );
};

// At most READINESS_MAX_CONCURRENT_PROBES probes run; a finished one hands its slot to the next.
let activeProbes = 0;
const waitingProbes: Array<() => void> = [];
const withProbeSlot = async <T>(run: () => Promise<T>): Promise<T> => {
  if (activeProbes >= READINESS_MAX_CONCURRENT_PROBES) {
    await new Promise<void>((resolve) => waitingProbes.push(resolve));
  } else {
    activeProbes++;
  }
  try {
    return await run();
  } finally {
    const next = waitingProbes.shift();
    if (next) next();
    else activeProbes--;
  }
};

const remember = (key: string, entry: CacheEntry): void => {
  cache.delete(key);
  cache.set(key, entry);
  // Insertion order is age order; drop the oldest first.
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
};

const parseTime = (value: unknown): string | null => {
  if (typeof value !== 'string' || value.length > 64) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
};

const plainText = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string') return null;
  // Control characters, and bidi overrides and isolates that could reorder what the user reads.
  // eslint-disable-next-line no-control-regex
  const text = value.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]+/g, ' ').trim();
  return text ? text.slice(0, max) : null;
};

// Contract section 3. Anything that does not fit is `unknown`, never `ready`.
export const parseReadinessBody = (body: unknown, now: number): ServiceReadiness => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return unknownResult(now);
  const record = body as Record<string, unknown>;
  if (record.version !== 1) return unknownResult(now);
  if (!STATES.includes(record.state as ServiceReadinessState)) return unknownResult(now);
  const state = record.state as ServiceReadinessState;

  const expiresAt = parseTime(record.expires_at);
  if (state === 'expiring' && !expiresAt) return unknownResult(now);

  let action: ServiceReadiness['action'] = null;
  const rawAction = record.action;
  if (rawAction && typeof rawAction === 'object' && !Array.isArray(rawAction)) {
    const label = plainText((rawAction as { label?: unknown }).label, MAX_ACTION_LABEL_LENGTH);
    const url = (rawAction as { url?: unknown }).url;
    if (label && typeof url === 'string' && isSafeHttpsUrl(url.trim())) {
      action = { label, url: url.trim() };
    }
  }
  return {
    state,
    summary: plainText(record.summary, MAX_SUMMARY_LENGTH),
    action,
    expiresAt,
    checkedAt: parseTime(record.checked_at) ?? new Date(now).toISOString(),
  };
};

// Reads at most `max` bytes; null when the body is larger.
const readCapped = async (response: Response, max: number): Promise<string | null> => {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) return null;
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
};

type Failure = 'timeout' | 'network' | 'status' | 'content' | 'oversize' | 'blocked' | 'credential';

const note = (server: string, reason: Failure): void => {
  // Category only: no URL, header, token or error text can reach the log.
  logger.warn('Readiness check did not complete', { server, reason });
};

const probe = async (
  user: ReadinessUser,
  serverName: string,
  definition: ServerConfig,
  readiness: ReadinessConfig,
  deps: ReadinessDeps,
  // Filled with the invalidation generation once the bearer is in hand, so a token refresh
  // while resolving it (which may report a change for this very pair) does not discard the answer.
  context: { generation: () => number; at?: number },
): Promise<ServiceReadiness> => {
  const now = deps.now();
  // The server's url may have changed since the declaration was saved: the bearer only ever goes
  // to the origin of the server the user connected to.
  let server: ServerConfig;
  try {
    server = await deps.expandServer(definition);
  } catch {
    note(serverName, 'blocked');
    return unknownResult(now);
  }
  if (!isSafeHttpsUrl(readiness.url) || !readinessOriginAllowed(readiness, server)) {
    note(serverName, 'blocked');
    return unknownResult(now);
  }

  let bearer: string;
  try {
    bearer = await deps.resolveBearer(user, serverName, definition);
    context.at = context.generation();
  } catch (error) {
    // A missing, stale or unrefreshable credential is MCPHub's to report as "sign in again".
    if (
      error instanceof MissingCredentialError ||
      // A personal OAuth token that expired and cannot be renewed: the user must reconnect.
      (error instanceof Error && /reconnect/i.test(error.message))
    ) {
      note(serverName, 'credential');
      return revokedResult(now);
    }
    note(serverName, 'network');
    return unknownResult(now);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs);
  try {
    // Never `allowInternal`: the user's credential must not reach private addresses. Zero hops:
    // a redirect would carry the bearer to a host the administrator did not choose.
    // The system allowlist of internal ranges does not apply here either (empty list).
    const guarded = createRedirectValidatingFetch(deps.fetch, false, deps.lookup, [], undefined, 0);
    const response = await guarded(readiness.url, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${bearer}` },
      redirect: 'manual',
      credentials: 'omit',
      signal: controller.signal,
    });
    if (response.status === 401 || response.status === 403) {
      void response.body?.cancel().catch(() => undefined);
      note(serverName, 'credential');
      return revokedResult(now);
    }
    if (response.status !== 200) {
      void response.body?.cancel().catch(() => undefined);
      note(serverName, 'status');
      return unknownResult(now);
    }
    if (!/\bjson\b/i.test(response.headers.get('content-type') ?? '')) {
      void response.body?.cancel().catch(() => undefined);
      note(serverName, 'content');
      return unknownResult(now);
    }
    const text = await readCapped(response, READINESS_MAX_BODY_BYTES);
    if (text === null) {
      note(serverName, 'oversize');
      return unknownResult(now);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      note(serverName, 'content');
      return unknownResult(now);
    }
    const result = parseReadinessBody(parsed, now);
    if (result.state === 'unknown') note(serverName, 'content');
    return result;
  } catch (error) {
    const name = (error as { name?: string } | undefined)?.name;
    note(
      serverName,
      controller.signal.aborted ? 'timeout' : name === 'UnsafeUrlError' ? 'blocked' : 'network',
    );
    return unknownResult(now);
  } finally {
    clearTimeout(timer);
  }
};

const defaultDeps = (): ReadinessDeps => ({
  resolveBearer: resolveReadinessBearer,
  expandServer: async (definition) =>
    (await import('./serverConfigEnvironment.js')).expandServerConfig(definition),
  fetch: (url, init) => fetch(url, init),
  now: () => Date.now(),
  timeoutMs: READINESS_TIMEOUT_MS,
});

/**
 * The state of one user's setup of one service, from the cache or a fresh probe. Null when the
 * server declares no readiness check. Never rejects. The caller decides whether the user's
 * credential is configured; a probe is only worth sending then.
 */
export const getServiceReadiness = async (
  user: ReadinessUser,
  serverName: string,
  definition: ServerConfig,
  options: ReadinessOptions = {},
): Promise<ServiceReadiness | null> => {
  const readiness = definition.readiness;
  if (!readiness) return null;
  ensureSubscribed();
  const deps: ReadinessDeps = { ...defaultDeps(), ...options.deps };
  const key = cacheKey(user.username, serverName);
  const declaration = JSON.stringify(readiness);
  const now = deps.now();

  const cached = cache.get(key);
  const usable = cached && cached.key === declaration ? cached : undefined;
  if (usable) {
    const fresh = usable.expiresAt > now;
    const throttled = options.refresh && now - usable.fetchedAt < READINESS_REFRESH_MIN_INTERVAL_MS;
    if (fresh && (!options.refresh || throttled)) return usable.value;
    // Stale while revalidate: the last answer now, a new one for the next read. An explicit
    // re-check, and an answer too old to trust, wait for the probe instead.
    if (!fresh && !options.refresh && now - usable.fetchedAt < READINESS_MAX_STALE_MS) {
      void startProbe(user, serverName, definition, readiness, deps, key, declaration);
      return usable.value;
    }
  }
  return startProbe(user, serverName, definition, readiness, deps, key, declaration);
};

// One probe at a time per user, service and declaration, within the global concurrency cap.
const startProbe = (
  user: ReadinessUser,
  serverName: string,
  definition: ServerConfig,
  readiness: ReadinessConfig,
  deps: ReadinessDeps,
  key: string,
  declaration: string,
): Promise<ServiceReadiness> => {
  const flightKey = `${key}\u0000${declaration}`;
  const running = inFlight.get(flightKey);
  if (running) return running;
  const generation = () => generationOf(user.username, serverName);
  const started = (async () => {
    const context: { generation: () => number; at?: number } = { generation };
    const begun = generation();
    try {
      const value = await withProbeSlot(() =>
        probe(user, serverName, definition, readiness, deps, context),
      );
      // The credential changed while the probe ran: its answer is about the old one.
      if ((context.at ?? begun) === generation()) {
        const failed = value.state === 'unknown' || value.state === 'revoked';
        const fetchedAt = deps.now();
        remember(key, {
          value,
          key: declaration,
          fetchedAt,
          expiresAt: fetchedAt + (failed ? READINESS_FAILURE_TTL_MS : READINESS_CACHE_TTL_MS),
        });
      }
      return value;
    } catch {
      return unknownResult(deps.now());
    } finally {
      inFlight.delete(flightKey);
    }
  })();
  inFlight.set(flightKey, started);
  return started;
};

/**
 * Like `getServiceReadiness`, but waits at most `waitMs`: a slow probe shows as `unknown` now and
 * still finishes in the background, filling the cache for the next read.
 */
export const getServiceReadinessBounded = async (
  user: ReadinessUser,
  serverName: string,
  definition: ServerConfig,
  options: { waitMs?: number; deps?: Partial<ReadinessDeps> } = {},
): Promise<ServiceReadiness | null> => {
  if (!definition.readiness) return null;
  const now = (options.deps?.now ?? Date.now)();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const slow = new Promise<ServiceReadiness>((resolve) => {
    timer = setTimeout(() => resolve(unknownResult(now)), options.waitMs ?? READINESS_LIST_WAIT_MS);
  });
  try {
    return await Promise.race([
      getServiceReadiness(user, serverName, definition, { deps: options.deps }),
      slow,
    ]);
  } catch {
    return unknownResult(now);
  } finally {
    clearTimeout(timer);
  }
};

/**
 * The bearer for a readiness declaration, from the same machinery tool calls use: the personal
 * OAuth access token (renewed by the OAuth provider when expired), or the user's value of a
 * credential slot (through the destination-bound binding resolver, which refuses a stale one).
 */
export async function resolveReadinessBearer(
  user: ReadinessUser,
  serverName: string,
  definition: ServerConfig,
): Promise<string> {
  const readiness = definition.readiness;
  if (!readiness) throw new MissingCredentialError('No readiness check is configured');

  if (readiness.auth === 'oauth') {
    const { hasPersonalOAuth, PersonalOAuthContext } = await import('./personalOAuthService.js');
    if (!hasPersonalOAuth(definition)) {
      // A configuration problem, not the user's credential being rejected.
      throw new Error('readiness.auth is "oauth" but this service has no personal OAuth');
    }
    const context = await PersonalOAuthContext.load(serverName, user.username, definition);
    const [{ MCPHubOAuthProvider }, { resolveSelfResourceForConnection }] = await Promise.all([
      import('./mcpOAuthProvider.js'),
      import('./selfOAuthResource.js'),
    ]);
    const selfResource = await resolveSelfResourceForConnection(serverName, context.config);
    const provider = await MCPHubOAuthProvider.create(serverName, context.config, selfResource);
    return provider.openApiAccessToken();
  }

  const { resolveCredentialBinding } = await import('./credentialBindingService.js');
  const { config } = await resolveCredentialBinding(serverName, user.username, definition);
  // `resolvedCredentialValues` follows the declared slot order. The resolver has already
  // validated the template, and the resolved URL no longer carries its slot placeholders, so
  // it is not validated again here.
  const wanted = readiness.auth.credential;
  const index = (config.credentialTemplate ?? []).findIndex((slot) => slot.name === wanted);
  const value = index >= 0 ? resolvedCredentialValues.get(config)?.[index] : undefined;
  if (!value) throw new MissingCredentialError('The credential slot has no value');
  // A header slot often holds a whole `Bearer ...` header value; the bearer is the token.
  return value.replace(/^Bearer\s+/i, '');
}
