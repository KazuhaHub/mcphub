import type {
  ReadinessConfig,
  ServerConfig,
  ServiceReadiness,
  ServiceReadinessState,
} from '../types/index.js';
import { MissingCredentialError, resolvedCredentialValues } from '../utils/credentialTemplate.js';
import { logger } from '../utils/logger.js';
import { isSafeHttpsUrl } from '../utils/readinessConfig.js';
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
// Bumped whenever a credential changes, so a probe that began earlier cannot cache its answer.
let generation = 0;

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
      generation++;
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
  // eslint-disable-next-line no-control-regex
  const text = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
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
): Promise<ServiceReadiness> => {
  const now = deps.now();
  if (!isSafeHttpsUrl(readiness.url)) {
    note(serverName, 'blocked');
    return unknownResult(now);
  }

  let bearer: string;
  try {
    bearer = await deps.resolveBearer(user, serverName, definition);
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
  if (cached && cached.key === declaration && cached.expiresAt > now) {
    const throttled = options.refresh && now - cached.fetchedAt < READINESS_REFRESH_MIN_INTERVAL_MS;
    if (!options.refresh || throttled) return cached.value;
  }

  // One probe at a time per user, service and declaration.
  const flightKey = `${key}\u0000${declaration}`;
  const running = inFlight.get(flightKey);
  if (running) return running;
  const startedGeneration = generation;
  const started = (async () => {
    try {
      const value = await probe(user, serverName, definition, readiness, deps);
      // The user's credential changed while the probe ran: its answer is about the old one.
      if (generation === startedGeneration) {
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
