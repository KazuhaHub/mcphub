import type { CredentialSlot, ReadinessConfig } from '../types/index.js';
import { ServerConfigValidationError } from './serverConfigValidation.js';

export const READINESS_URL_MAX_LENGTH = 2048;
export const READINESS_SLOT_NAME_MAX_LENGTH = 128;

// `${VAR}` in the scheme, host or port: not a real origin until expanded, and never the same
// origin as another URL just because the text matches.
export const hasAuthorityPlaceholder = (value: string): boolean => {
  const schemeEnd = value.indexOf('://');
  const authorityStart = schemeEnd === -1 ? 0 : schemeEnd + 3;
  const rest = value.slice(authorityStart);
  const authority = rest.slice(0, rest.search(/[/?#]|$/));
  return value.slice(0, authorityStart).includes('$') || authority.includes('$');
};

// An absolute https URL without embedded credentials. Loopback http is not allowed: the hub
// sends a user's credential to this URL, so it is never a development shortcut.
export const isSafeHttpsUrl = (value: string): boolean => {
  if (value.length === 0 || value.length > READINESS_URL_MAX_LENGTH) return false;
  if (hasAuthorityPlaceholder(value)) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
};

/**
 * Returns the normalized readiness declaration, or undefined for an unset (null, undefined or
 * empty string) value. The shape is exactly `{ url, auth }`; `auth` is `'oauth'` or
 * `{ credential: <slot name> }`. Whether the slot exists is checked by `readinessSlotProblem`,
 * because on an edit the credential template may come from the stored server.
 */
export const normalizeReadiness = (value: unknown): ReadinessConfig | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new ServerConfigValidationError('readiness must be an object with url and auth');
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== 'url' && key !== 'auth')) {
    throw new ServerConfigValidationError('readiness accepts only url and auth');
  }
  if (typeof record.url !== 'string') {
    throw new ServerConfigValidationError('readiness.url must be a string');
  }
  const url = record.url.trim();
  if (url.length > READINESS_URL_MAX_LENGTH) {
    throw new ServerConfigValidationError(
      `readiness.url must be at most ${READINESS_URL_MAX_LENGTH} characters`,
    );
  }
  if (!isSafeHttpsUrl(url)) {
    throw new ServerConfigValidationError(
      'readiness.url must be an absolute https URL without credentials',
    );
  }

  const auth = record.auth;
  if (auth === 'oauth') return { url, auth };
  if (
    auth &&
    typeof auth === 'object' &&
    !Array.isArray(auth) &&
    Object.keys(auth).length === 1 &&
    typeof (auth as { credential?: unknown }).credential === 'string'
  ) {
    const credential = (auth as { credential: string }).credential;
    if (credential.length > 0 && credential.length <= READINESS_SLOT_NAME_MAX_LENGTH) {
      return { url, auth: { credential } };
    }
  }
  throw new ServerConfigValidationError(
    'readiness.auth must be "oauth" or { credential: <credential slot name> }',
  );
};

// A message when the declaration names a credential slot the server does not have.
export const readinessSlotProblem = (
  readiness: ReadinessConfig | undefined,
  template: readonly Pick<CredentialSlot, 'name'>[] | undefined,
): string | null => {
  if (!readiness || readiness.auth === 'oauth') return null;
  const name = readiness.auth.credential;
  return template?.some((slot) => slot.name === name)
    ? null
    : `readiness.auth.credential must name one of the server's credential slots ("${name}" is not one)`;
};

export const originOf = (value: string): string | null => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' ? parsed.origin : null;
  } catch {
    return null;
  }
};

type ReadinessServer = {
  type?: string;
  url?: string;
  openapi?: { url?: string };
  oauth?: { identityMode?: string; resource?: string };
  credentialTemplate?: readonly Pick<CredentialSlot, 'name'>[];
};

/**
 * The URL whose origin receives this server's credential today, or undefined when the server
 * declares none. Remote MCP sends everything to `url`. An OpenAPI server sends slot values to
 * the origin of its document URL (assertDeclaredOrigin in clients/openapi.ts) and a personal
 * OAuth token to `oauth.resource`, else the document URL (the personal-token check in the same
 * client). A stdio server, or an OpenAPI server with an inline schema, has no origin.
 */
export const readinessCredentialUrl = (
  server: ReadinessServer,
  auth: ReadinessConfig['auth'],
): string | undefined => {
  if (server.type === 'openapi') {
    return (auth === 'oauth' ? server.oauth?.resource : undefined) ?? server.openapi?.url;
  }
  return server.url;
};

// Whether the server has no origin to compare, so the readiness URL joins the fingerprints.
export const readinessNeedsFingerprint = (
  server: ReadinessServer & { readiness?: ReadinessConfig },
): boolean => Boolean(server.readiness) && !readinessCredentialUrl(server, server.readiness!.auth);

/**
 * Whether the readiness URL may receive this server's users' credentials. The readiness URL must
 * share the origin (https, host and port; the path is free) the credential already goes to
 * (`readinessCredentialUrl`). A server with no such origin has its credential bindings tied to
 * the readiness URL instead (credentialDestination.ts, personalOAuthService.ts).
 * `auth: 'oauth'` needs personal OAuth, otherwise there is no token to send. Fails closed when
 * the server URL cannot be read.
 */
export const readinessServerProblem = (
  readiness: ReadinessConfig | undefined,
  server: ReadinessServer,
): string | null => {
  if (!readiness) return null;
  if (readiness.auth === 'oauth' && server.oauth?.identityMode !== 'personal') {
    return 'readiness.auth "oauth" requires a server with personal OAuth';
  }
  const slotProblem = readinessSlotProblem(readiness, server.credentialTemplate);
  if (slotProblem) return slotProblem;
  const base = readinessCredentialUrl(server, readiness.auth);
  if (base && hasAuthorityPlaceholder(base)) {
    return "the server's url has a ${...} placeholder in its scheme, host or port, so readiness.url cannot be checked against it";
  }
  if (base) {
    const serverOrigin = originOf(base);
    if (!serverOrigin || serverOrigin !== originOf(readiness.url)) {
      return "readiness.url must have the same origin (https, host and port) as the server's url";
    }
  }
  return null;
};

// The probe-time form of the same rule, for a server definition as connections see it.
export const readinessOriginAllowed = (
  readiness: ReadinessConfig,
  server: ReadinessServer,
): boolean => {
  const base = readinessCredentialUrl(server, readiness.auth);
  if (!base) return true;
  const origin = originOf(base);
  return origin !== null && origin === originOf(readiness.url);
};
