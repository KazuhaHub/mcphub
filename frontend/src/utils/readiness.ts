import type { ReadinessConfig, WorkspaceReadiness, WorkspaceReadinessState } from '../types';
import type { ServiceChip, StatusTone } from './workspace';

export const READINESS_URL_MAX_LENGTH = 2048;

export const readinessTone = (state: WorkspaceReadinessState): StatusTone => {
  if (state === 'ready') return 'ok';
  return state === 'expired' || state === 'revoked' ? 'err' : 'warn';
};

const isHttpsWithoutCredentials = (value: string): boolean => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
};

/** The link as an href, or undefined unless it is a plain https link. */
export const getSafeActionHref = (value?: string | null): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed && isHttpsWithoutCredentials(trimmed) ? trimmed : undefined;
};

/** The service's own fix-it action, when the state asks for one and the link is safe. */
export const readinessPrimaryAction = (
  readiness?: WorkspaceReadiness | null,
): { label: string; url: string } | undefined => {
  if (!readiness || readiness.state === 'ready' || !readiness.action) return undefined;
  const url = getSafeActionHref(readiness.action.url);
  return url ? { label: readiness.action.label, url } : undefined;
};

export interface ReadinessExpiryNote {
  kind: 'expires' | 'expired';
  date: string;
}

/** When the setup expires (still to come) or expired, if the service said. */
export const readinessExpiryNote = (
  readiness: WorkspaceReadiness | null | undefined,
  now: number = Date.now(),
): ReadinessExpiryNote | null => {
  if (!readiness?.expiresAt) return null;
  const at = Date.parse(readiness.expiresAt);
  if (Number.isNaN(at)) return null;
  if (readiness.state === 'expired') return { kind: 'expired', date: readiness.expiresAt };
  if (readiness.state === 'revoked' || readiness.state === 'unknown') return null;
  return at > now ? { kind: 'expires', date: readiness.expiresAt } : null;
};

/**
 * A row shows the readiness chip in place of "ready": anything the user must fix first (sign in,
 * credentials, an administrator's pause) is more important and keeps its own chip.
 */
export const shouldShowReadinessChip = (
  readiness: WorkspaceReadiness | null | undefined,
  chip: ServiceChip,
): boolean => Boolean(readiness) && chip === 'ready';

export type ReadinessProblem =
  | 'tooLong'
  | 'invalid'
  | 'scheme'
  | 'credentials'
  | 'authRequired'
  | 'slotMissing';

const CREDENTIAL_PREFIX = 'credential:';

/** The stored declaration as form values. OAuth is the default choice while nothing is set. */
export const readinessToForm = (
  readiness?: ReadinessConfig | null,
): { readinessUrl: string; readinessAuth: string } => ({
  readinessUrl: readiness?.url ?? '',
  readinessAuth: !readiness
    ? 'oauth'
    : readiness.auth === 'oauth'
      ? 'oauth'
      : `${CREDENTIAL_PREFIX}${readiness.auth.credential}`,
});

/** The declaration to send, or null to clear it (an empty URL means none). */
export const buildReadinessConfig = (
  url: string | undefined,
  auth: string | undefined,
): ReadinessConfig | null => {
  const trimmed = url?.trim();
  if (!trimmed) return null;
  if (auth?.startsWith(CREDENTIAL_PREFIX)) {
    return { url: trimmed, auth: { credential: auth.slice(CREDENTIAL_PREFIX.length) } };
  }
  return { url: trimmed, auth: 'oauth' };
};

/**
 * Mirrors the backend rule: https only (no loopback exception, the hub sends a user's credential
 * there), no embedded credentials, and a credential slot must be one the server declares. Only
 * administrators edit the field, so nothing is checked for anyone else.
 */
export const getReadinessProblem = (
  url: string | undefined,
  auth: string | undefined,
  slotNames: readonly string[],
  isAdmin: boolean,
): ReadinessProblem | null => {
  const trimmed = url?.trim();
  if (!isAdmin || !trimmed) return null;
  if (trimmed.length > READINESS_URL_MAX_LENGTH) return 'tooLong';
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return 'invalid';
  }
  if (parsed.protocol !== 'https:') return 'scheme';
  if (parsed.username || parsed.password) return 'credentials';
  if (auth === 'oauth') return null;
  if (!auth?.startsWith(CREDENTIAL_PREFIX)) return 'authRequired';
  return slotNames.includes(auth.slice(CREDENTIAL_PREFIX.length)) ? null : 'slotMissing';
};

/**
 * A date and time in the UI language: the date plus hours and minutes, no seconds. `timeZone`
 * is only for tests; the browser's own zone is used otherwise. Text that is not a date is
 * returned as it came.
 */
export const formatReadinessDate = (
  value: string,
  language?: string,
  timeZone?: string,
): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(language, { dateStyle: 'medium', timeStyle: 'short', timeZone });
};
