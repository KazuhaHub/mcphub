import { LoginMode } from '../types/index.js';

export const LOGIN_MODES: readonly LoginMode[] = ['dual', 'sso_first', 'sso_redirect'];
export const DEFAULT_LOGIN_MODE: LoginMode = 'dual';
export const OIDC_DISPLAY_NAME_MAX_LENGTH = 60;

export const isLoginMode = (value: unknown): value is LoginMode =>
  typeof value === 'string' && (LOGIN_MODES as readonly string[]).includes(value);

// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/**
 * Validates the login-presentation fields of a `auth.betterAuth` update.
 * `null` clears a field. Returns an error message, or null when the update is acceptable.
 */
export const validateLoginPresentationUpdate = (betterAuth: unknown): string | null => {
  if (!betterAuth || typeof betterAuth !== 'object') return null;
  const { loginMode, providers } = betterAuth as {
    loginMode?: unknown;
    providers?: { oidc?: { displayName?: unknown } };
  };
  if (loginMode !== undefined && loginMode !== null && !isLoginMode(loginMode)) {
    return `auth.betterAuth.loginMode must be one of ${LOGIN_MODES.join(', ')}`;
  }
  const displayName = providers?.oidc?.displayName;
  if (displayName !== undefined && displayName !== null) {
    if (
      typeof displayName !== 'string' ||
      displayName.trim().length > OIDC_DISPLAY_NAME_MAX_LENGTH ||
      CONTROL_CHARACTERS.test(displayName)
    ) {
      return `auth.betterAuth.providers.oidc.displayName must be plain text of at most ${OIDC_DISPLAY_NAME_MAX_LENGTH} characters`;
    }
  }
  return null;
};
