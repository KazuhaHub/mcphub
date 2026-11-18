/**
 * Client ID Metadata Documents (CIMD) support for MCPHub's authorization server.
 *
 * Implements the client side of draft-ietf-oauth-client-id-metadata-document:
 * a client may present an HTTPS URL as its client_id; the authorization server
 * fetches a metadata document from that URL and uses it in place of a
 * registration. CIMD clients are always treated as PUBLIC clients (no shared
 * secret can be established out-of-band), so PKCE with S256 is enforced by the
 * existing public-client policy.
 *
 * Documents are fetched with SSRF protection (private-IP blocklist +
 * redirect validation, shared with upstream MCP connections) and cached with
 * a TTL. Resolution is opt-in via systemConfig.oauthServer.clientIdMetadata.enabled.
 */

import { getSystemConfigDao } from '../dao/index.js';
import { cloneDefaultOAuthServerConfig } from '../constants/oauthServerDefaults.js';
import { findOAuthClientById } from '../models/OAuth.js';
import { assertSafeUrl, createRedirectValidatingFetch, type SsrfLookup } from '../utils/ssrf.js';
import type { IOAuthClient } from '../types/index.js';
import { logger } from '../utils/logger.js';

const METADATA_FETCH_TIMEOUT_MS = 5_000;
const DEFAULT_CACHE_TTL_MS = 3_600_000;
// The draft recommends a 5 KB cap; 16 KB leaves room for an inline jwks.
const MAX_DOCUMENT_BYTES = 16 * 1024;
const MAX_CLIENT_ID_LENGTH = 2048;
// Effective cache lifetime bounds (draft section 6.2: enforce a minimum and a maximum).
const MIN_CACHE_TTL_MS = 30_000;
const MAX_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export const isCimdClientId = (clientId: string): boolean => {
  return typeof clientId === 'string' && clientId.startsWith('https://');
};

/**
 * Check a URL-shaped client_id against draft-ietf-oauth-client-id-metadata-document
 * section 3: https scheme, a path other than "/", no "." or ".." segments, no
 * fragment, no userinfo. The raw string is inspected because URL parsing would
 * silently normalise dot segments away (and an authorization server must not
 * normalise the identifier). A query component is discouraged but allowed.
 * Returns a human-readable reason when invalid, undefined when acceptable.
 */
export const validateCimdClientIdUrl = (clientId: string): string | undefined => {
  if (typeof clientId !== 'string' || clientId.length > MAX_CLIENT_ID_LENGTH) {
    return 'client_id URL is too long';
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0020\u007f\\]/.test(clientId)) {
    return 'client_id URL contains forbidden characters';
  }
  if (!clientId.startsWith('https://')) {
    return 'client_id URL must use the https scheme';
  }
  if (clientId.includes('#')) {
    return 'client_id URL must not contain a fragment';
  }
  const rest = clientId.slice('https://'.length);
  const pathStart = rest.search(/[/?]/);
  const authority = pathStart === -1 ? rest : rest.slice(0, pathStart);
  if (authority.includes('@')) {
    return 'client_id URL must not contain userinfo';
  }
  let parsed: URL;
  try {
    parsed = new URL(clientId);
  } catch {
    return 'client_id is not a valid URL';
  }
  if (parsed.protocol !== 'https:' || !parsed.hostname) {
    return 'client_id URL must use the https scheme';
  }
  const afterAuthority = pathStart === -1 ? '' : rest.slice(pathStart);
  const rawPath = afterAuthority.split('?')[0];
  if (rawPath === '' || rawPath === '/') {
    return 'client_id URL must have a path component';
  }
  const segments = rawPath.split('/');
  const hasDotSegment = segments.some((segment) => {
    let decoded = segment;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      // keep the raw segment
    }
    return decoded === '.' || decoded === '..';
  });
  if (hasDotSegment) {
    return 'client_id URL must not contain dot segments';
  }
  return undefined;
};

/** Host (with port, if any) of a CIMD client_id, for display to the user. */
export const getCimdClientHost = (clientId: string): string | undefined => {
  if (!isCimdClientId(clientId)) return undefined;
  try {
    return new URL(clientId).host;
  } catch {
    return undefined;
  }
};

interface CimdDocument {
  client_id?: unknown;
  client_name?: unknown;
  redirect_uris?: unknown;
  token_endpoint_auth_method?: unknown;
  application_type?: unknown;
  contacts?: unknown;
  logo_uri?: unknown;
  client_uri?: unknown;
  policy_uri?: unknown;
  tos_uri?: unknown;
  jwks_uri?: unknown;
  jwks?: unknown;
  client_secret?: unknown;
  client_secret_expires_at?: unknown;
  token_endpoint_auth_methods_supported?: unknown;
  grant_types?: unknown;
  response_types?: unknown;
}

interface CacheEntry {
  client: IOAuthClient;
  expiresAt: number;
}

// Bounded so that unique attacker-chosen client_ids cannot grow memory for the cache lifetime.
// Map iteration order is insertion order, so the first key is the oldest entry.
const MAX_CACHE_ENTRIES = 1000;
const cache = new Map<string, CacheEntry>();

const cacheClient = (clientId: string, entry: CacheEntry): void => {
  const now = Date.now();
  cache.delete(clientId);
  if (cache.size >= MAX_CACHE_ENTRIES) {
    for (const [key, value] of cache) {
      if (value.expiresAt <= now) cache.delete(key);
    }
    while (cache.size >= MAX_CACHE_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  }
  cache.set(clientId, entry);
};
const inflight = new Map<string, Promise<IOAuthClient | undefined>>();

let fetchImpl: typeof fetch = (...args) => fetch(...args);

// Test seam: DNS resolution used by the SSRF guard, so tests never hit real DNS.
let ssrfLookupOverride: SsrfLookup | undefined;

/** Test seam: replace the fetch implementation used for metadata retrieval. */
export const setCimdFetchImplForTesting = (impl: typeof fetch): void => {
  fetchImpl = impl;
};

/** Test seam: replace DNS resolution used by the SSRF guard. */
export const setCimdDnsLookupForTesting = (lookup?: SsrfLookup): void => {
  ssrfLookupOverride = lookup;
};

/** Test seam: number of cached documents. */
export const getCimdCacheSizeForTesting = (): number => cache.size;

export const clearCimdCacheForTesting = (): void => {
  cache.clear();
  inflight.clear();
};

interface CimdSettings {
  enabled: boolean;
  cacheTtlMs: number;
}

export const getCimdSettings = async (): Promise<CimdSettings> => {
  try {
    const systemConfig = await getSystemConfigDao().get();
    const merged = { ...cloneDefaultOAuthServerConfig(), ...systemConfig?.oauthServer };
    const ttl =
      typeof merged.clientIdMetadata?.cacheTtlMs === 'number' &&
      merged.clientIdMetadata.cacheTtlMs > 0
        ? merged.clientIdMetadata.cacheTtlMs
        : DEFAULT_CACHE_TTL_MS;
    return { enabled: merged.clientIdMetadata?.enabled === true, cacheTtlMs: ttl };
  } catch {
    return { enabled: false, cacheTtlMs: DEFAULT_CACHE_TTL_MS };
  }
};

const SUPPORTED_GRANT_TYPES = ['authorization_code', 'refresh_token'];

const isValidRedirectUri = (uri: string): boolean => {
  if (!uri || uri.includes('#')) return false;
  try {
    const parsed = new URL(uri);
    return !['javascript:', 'data:', 'vbscript:', 'file:'].includes(parsed.protocol);
  } catch {
    return false;
  }
};

const asStringArray = (value: unknown): string[] | undefined =>
  Array.isArray(value) && value.every((v) => typeof v === 'string')
    ? (value as string[])
    : undefined;

/**
 * Validate a fetched metadata document and map it onto an IOAuthClient.
 * Returns undefined when the document is not a usable CIMD client.
 */
export const mapCimdDocument = (
  clientIdUrl: string,
  document: CimdDocument,
): IOAuthClient | undefined => {
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    return undefined;
  }

  // The document's client_id MUST be present and identical to the URL it was
  // retrieved from (draft-ietf-oauth-client-id-metadata-document, section 4).
  if (document.client_id !== clientIdUrl) {
    return undefined;
  }

  // MCP client-registration: client_id, client_name and redirect_uris are required.
  if (typeof document.client_name !== 'string' || document.client_name.trim().length === 0) {
    return undefined;
  }

  const redirectUris = asStringArray(document.redirect_uris);
  if (!redirectUris || redirectUris.length === 0 || !redirectUris.every(isValidRedirectUri)) {
    return undefined;
  }

  // Draft section 4.1: no shared secrets, and jwks / jwks_uri are mutually exclusive.
  if (document.client_secret !== undefined || document.client_secret_expires_at !== undefined) {
    return undefined;
  }
  if (document.jwks !== undefined && document.jwks_uri !== undefined) {
    return undefined;
  }

  // Only public clients can be expressed via CIMD on this server (no private_key_jwt),
  // so "none" must be the declared (or implied) authentication method.
  if (
    document.token_endpoint_auth_method !== undefined &&
    document.token_endpoint_auth_method !== 'none'
  ) {
    return undefined;
  }
  if (document.token_endpoint_auth_methods_supported !== undefined) {
    const methods = asStringArray(document.token_endpoint_auth_methods_supported);
    if (!methods || !methods.includes('none')) {
      return undefined;
    }
    if (
      typeof document.token_endpoint_auth_method === 'string' &&
      !methods.includes(document.token_endpoint_auth_method)
    ) {
      return undefined;
    }
  }

  // Draft section 6: intersect grant_types / response_types with what this server
  // supports; an empty intersection is rejected (invalid_client).
  if (document.grant_types !== undefined) {
    const grantTypes = asStringArray(document.grant_types);
    if (!grantTypes || !grantTypes.some((g) => SUPPORTED_GRANT_TYPES.includes(g))) {
      return undefined;
    }
  }
  if (document.response_types !== undefined) {
    const responseTypes = asStringArray(document.response_types);
    if (!responseTypes || !responseTypes.includes('code')) {
      return undefined;
    }
  }

  const applicationType =
    document.application_type === 'native' ? ('native' as const) : ('web' as const);
  const contacts = asStringArray(document.contacts);
  const optionalUriField = (value: unknown): string | undefined =>
    typeof value === 'string' && value.length > 0 ? value : undefined;

  return {
    clientId: clientIdUrl,
    name: document.client_name.trim(),
    redirectUris,
    grants: ['authorization_code', 'refresh_token'],
    metadata: {
      application_type: applicationType,
      ...(contacts ? { contacts } : {}),
      ...(optionalUriField(document.logo_uri)
        ? { logo_uri: optionalUriField(document.logo_uri) }
        : {}),
      ...(optionalUriField(document.client_uri)
        ? { client_uri: optionalUriField(document.client_uri) }
        : {}),
      ...(optionalUriField(document.policy_uri)
        ? { policy_uri: optionalUriField(document.policy_uri) }
        : {}),
      ...(optionalUriField(document.tos_uri)
        ? { tos_uri: optionalUriField(document.tos_uri) }
        : {}),
      ...(optionalUriField(document.jwks_uri)
        ? { jwks_uri: optionalUriField(document.jwks_uri) }
        : {}),
    },
  };
};

/**
 * Effective cache lifetime from the response's Cache-Control (RFC 9111), bounded
 * below by MIN_CACHE_TTL_MS and above by the configured TTL (itself capped at
 * MAX_CACHE_TTL_MS). Returns 0 when the response must not be stored (no-store).
 */
export const computeCimdCacheTtlMs = (headers: Headers, configuredTtlMs: number): number => {
  const ceiling = Math.min(Math.max(configuredTtlMs, MIN_CACHE_TTL_MS), MAX_CACHE_TTL_MS);
  const cacheControl = (headers.get('cache-control') || '').toLowerCase();
  const directives = cacheControl.split(',').map((d) => d.trim());
  if (directives.includes('no-store')) {
    return 0;
  }
  const maxAge = directives.find((d) => d.startsWith('max-age='));
  if (maxAge) {
    const seconds = Number(maxAge.slice('max-age='.length).replace(/"/g, ''));
    if (Number.isFinite(seconds) && seconds >= 0) {
      const ageSeconds = Number(headers.get('age'));
      const remaining = seconds - (Number.isFinite(ageSeconds) && ageSeconds > 0 ? ageSeconds : 0);
      return Math.min(Math.max(remaining * 1000, MIN_CACHE_TTL_MS), ceiling);
    }
  }
  // no-cache (must revalidate) and absent directives get the minimum / configured TTL.
  return directives.includes('no-cache') ? Math.min(MIN_CACHE_TTL_MS, ceiling) : ceiling;
};

interface FetchedCimdClient {
  client: IOAuthClient;
  ttlMs: number;
}

/** Read at most MAX_DOCUMENT_BYTES of the body; undefined when it is larger. */
const readBoundedText = async (response: Response): Promise<string | undefined> => {
  if (!response.body) {
    const text = await response.text();
    return Buffer.byteLength(text) > MAX_DOCUMENT_BYTES ? undefined : text;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_DOCUMENT_BYTES) {
      await reader.cancel().catch(() => undefined);
      return undefined;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
};

const fetchCimdDocument = async (
  clientIdUrl: string,
  configuredTtlMs: number,
): Promise<FetchedCimdClient | undefined> => {
  await assertSafeUrl(clientIdUrl, {
    allowInternal: false,
    allowedCidrs: [],
    ...(ssrfLookupOverride ? { lookup: ssrfLookupOverride } : {}),
  });

  // The draft forbids following redirects. The SSRF-validating wrapper would follow
  // them, so a 3xx is intercepted before it can and treated as a failure.
  let redirected = false;
  const validatingFetch = createRedirectValidatingFetch(
    async (url, init) => {
      const res = await fetchImpl(url, init);
      if (res.status >= 300 && res.status < 400) {
        redirected = true;
        return new Response(null, { status: 502 });
      }
      return res;
    },
    false,
    ssrfLookupOverride,
    [],
  );
  const response = await validatingFetch(clientIdUrl, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'omit',
    signal: AbortSignal.timeout(METADATA_FETCH_TIMEOUT_MS),
    redirect: 'manual',
  });

  if (redirected || response.status !== 200) {
    logger.warn('CIMD metadata document fetch failed', {
      clientIdUrl,
      status: response.status,
      redirected,
    });
    return undefined;
  }

  const contentLength = Number(response.headers.get('content-length') || '0');
  if (contentLength > MAX_DOCUMENT_BYTES) {
    logger.warn('CIMD metadata document exceeds size limit', { clientIdUrl });
    return undefined;
  }

  let document: CimdDocument;
  try {
    const text = await readBoundedText(response);
    if (text === undefined) {
      logger.warn('CIMD metadata document exceeds size limit', { clientIdUrl });
      return undefined;
    }
    document = JSON.parse(text) as CimdDocument;
  } catch (error) {
    logger.warn('CIMD metadata document is not valid JSON', { clientIdUrl, error });
    return undefined;
  }

  const mapped = mapCimdDocument(clientIdUrl, document);
  if (!mapped) {
    logger.warn('CIMD metadata document failed validation', { clientIdUrl });
    return undefined;
  }
  return { client: mapped, ttlMs: computeCimdCacheTtlMs(response.headers, configuredTtlMs) };
};

/**
 * Resolve a URL-shaped client_id to a client by fetching (or caching) its
 * metadata document. Returns undefined for anything that is not a valid,
 * enabled CIMD identifier. Failures and invalid documents are never cached.
 */
export const resolveCimdClient = async (
  clientId: string,
  settings?: CimdSettings,
): Promise<IOAuthClient | undefined> => {
  const resolvedSettings = settings ?? (await getCimdSettings());
  if (!resolvedSettings.enabled || !isCimdClientId(clientId)) {
    return undefined;
  }
  if (validateCimdClientIdUrl(clientId)) {
    return undefined;
  }

  const now = Date.now();
  const cached = cache.get(clientId);
  if (cached && cached.expiresAt > now) {
    return cached.client;
  }
  if (cached) {
    cache.delete(clientId);
  }

  const existingFetch = inflight.get(clientId);
  if (existingFetch) {
    return existingFetch;
  }

  const fetchPromise = fetchCimdDocument(clientId, resolvedSettings.cacheTtlMs)
    .then((fetched) => {
      if (!fetched) return undefined;
      if (fetched.ttlMs > 0) {
        cacheClient(clientId, {
          client: fetched.client,
          expiresAt: Date.now() + fetched.ttlMs,
        });
      } else {
        cache.delete(clientId);
      }
      return fetched.client;
    })
    .catch((error) => {
      logger.warn('Failed to resolve CIMD client', { clientId, error });
      return undefined;
    })
    .finally(() => {
      inflight.delete(clientId);
    });

  inflight.set(clientId, fetchPromise);
  return fetchPromise;
};

/**
 * Client lookup used across the authorization server surface: registered
 * clients first, then CIMD resolution when enabled. Drop-in replacement for
 * findOAuthClientById at every call site that must understand CIMD clients.
 */
export const findOAuthClientIncludingCimd = async (
  clientId: string,
): Promise<IOAuthClient | undefined> => {
  const persisted = await findOAuthClientById(clientId);
  if (persisted) {
    return persisted;
  }
  return resolveCimdClient(clientId);
};

/**
 * Minimal client record for validating an already-issued access token of a CIMD
 * client. No document is fetched: a bearer check on every MCP request must not
 * depend on the client's server being reachable (draft section 6.1: transient
 * failures must not invalidate trust). The token stays valid only while CIMD
 * resolution is enabled and the identifier is still well-formed.
 */
export const findCimdClientStub = async (clientId: string): Promise<IOAuthClient | undefined> => {
  if (!isCimdClientId(clientId) || validateCimdClientIdUrl(clientId)) return undefined;
  const settings = await getCimdSettings();
  if (!settings.enabled) return undefined;
  return {
    clientId,
    name: clientId,
    redirectUris: [],
    grants: SUPPORTED_GRANT_TYPES,
  };
};
