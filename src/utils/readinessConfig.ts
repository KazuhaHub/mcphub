import type { CredentialSlot, ReadinessConfig } from '../types/index.js';
import { ServerConfigValidationError } from './serverConfigValidation.js';

export const READINESS_URL_MAX_LENGTH = 2048;
export const READINESS_SLOT_NAME_MAX_LENGTH = 128;

// An absolute https URL without embedded credentials. Loopback http is not allowed: the hub
// sends a user's credential to this URL, so it is never a development shortcut.
export const isSafeHttpsUrl = (value: string): boolean => {
  if (value.length === 0 || value.length > READINESS_URL_MAX_LENGTH) return false;
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

const originOf = (value: string): string | null => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' ? parsed.origin : null;
  } catch {
    return null;
  }
};

/**
 * Whether the readiness URL may receive this server's users' credentials. A server with a `url`
 * only ever sends credentials to that origin, so the readiness URL must share its origin (https,
 * host and port; the path is free). A server without a `url` (stdio, OpenAPI) has no such origin;
 * its credential bindings are instead tied to the readiness URL (credentialDestination.ts).
 * `auth: 'oauth'` needs personal OAuth, otherwise there is no token to send. Fails closed when
 * the server URL cannot be read.
 */
export const readinessServerProblem = (
  readiness: ReadinessConfig | undefined,
  server: {
    url?: string;
    oauth?: { identityMode?: string };
    credentialTemplate?: readonly Pick<CredentialSlot, 'name'>[];
  },
): string | null => {
  if (!readiness) return null;
  if (readiness.auth === 'oauth' && server.oauth?.identityMode !== 'personal') {
    return 'readiness.auth "oauth" requires a server with personal OAuth';
  }
  const slotProblem = readinessSlotProblem(readiness, server.credentialTemplate);
  if (slotProblem) return slotProblem;
  if (server.url) {
    const serverOrigin = originOf(server.url);
    if (!serverOrigin || serverOrigin !== originOf(readiness.url)) {
      return "readiness.url must have the same origin (https, host and port) as the server's url";
    }
  }
  return null;
};

// The probe-time form of the same rule, for a server definition as stored.
export const readinessOriginAllowed = (readiness: ReadinessConfig, serverUrl?: string): boolean =>
  !serverUrl || (originOf(serverUrl) !== null && originOf(serverUrl) === originOf(readiness.url));
