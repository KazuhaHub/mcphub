import { LoginMode } from '../types/index.js';

export const LOGIN_MODES: readonly LoginMode[] = ['dual', 'sso_first', 'sso_redirect'];
export const DEFAULT_LOGIN_MODE: LoginMode = 'dual';
export const OIDC_DISPLAY_NAME_MAX_LENGTH = 60;

export const isLoginMode = (value: unknown): value is LoginMode =>
  typeof value === 'string' && (LOGIN_MODES as readonly string[]).includes(value);

// Control characters, plus the invisible ones that can disguise a label: zero-width characters
// and marks (U+200B-U+200F), bidi embedding/override (U+202A-U+202E) and isolates
// (U+2066-U+2069), and the byte order mark (U+FEFF)
// eslint-disable-next-line no-control-regex
const FORBIDDEN_DISPLAY_NAME_CHARACTERS = /[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/;

/** A display name that can be shown as is: at most 60 characters of visible plain text. */
export const isValidOidcDisplayName = (value: string): boolean =>
  value.trim().length <= OIDC_DISPLAY_NAME_MAX_LENGTH &&
  !FORBIDDEN_DISPLAY_NAME_CHARACTERS.test(value);

/**
 * `BETTER_AUTH_LOGIN_MODE`, case-insensitive. `undefined` when unset; `invalid` carries a value
 * that is set but not a login mode, which is then ignored.
 */
export const parseLoginModeEnv = (
  value: string | undefined,
): { mode?: LoginMode; invalid?: string } => {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return {};
  return isLoginMode(normalized) ? { mode: normalized } : { invalid: value!.trim() };
};

/**
 * Validates the login-presentation fields of a `auth.betterAuth` update.
 * `null` clears a field. Returns an error message, or null when the update is acceptable.
 */
export const validateLoginPresentationUpdate = (betterAuth: unknown): string | null => {
  if (!betterAuth || typeof betterAuth !== 'object') return null;
  const { loginMode, adminPasswordLogin, providers } = betterAuth as {
    loginMode?: unknown;
    adminPasswordLogin?: unknown;
    providers?: { oidc?: { displayName?: unknown } };
  };
  if (adminPasswordLogin !== undefined && typeof adminPasswordLogin !== 'boolean') {
    return 'auth.betterAuth.adminPasswordLogin must be a boolean';
  }
  if (loginMode !== undefined && loginMode !== null && !isLoginMode(loginMode)) {
    return `auth.betterAuth.loginMode must be one of ${LOGIN_MODES.join(', ')}`;
  }
  const displayName = providers?.oidc?.displayName;
  if (displayName !== undefined && displayName !== null) {
    if (typeof displayName !== 'string' || !isValidOidcDisplayName(displayName)) {
      return `auth.betterAuth.providers.oidc.displayName must be plain text of at most ${OIDC_DISPLAY_NAME_MAX_LENGTH} characters`;
    }
  }
  return null;
};
