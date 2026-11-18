/**
 * How the login page presents SSO, and when it may send the browser straight to the identity
 * provider. The server publishes the effective `loginMode` (see `resolveBetterAuthRuntimeConfig`);
 * this module adds the per-visit guards that keep `sso_redirect` from ever looping.
 */

export type LoginMode = 'dual' | 'sso_first' | 'sso_redirect';
export type SsoProvider = 'oidc' | 'google' | 'github';
export type LoginView = 'dual' | 'sso_first' | 'redirecting';

/** Why `sso_redirect` did not redirect on this visit. */
export type AutoRedirectBlock =
  | 'local' // ?local: the emergency way to the password form
  | 'error' // ?error: the previous SSO attempt came back with an error
  | 'loggedOut' // the user signed out, in any tab, within the last five minutes
  | 'recentAttempt' // this tab already auto-redirected a moment ago
  | 'noStorage' // browser storage is unavailable, so the guards cannot be recorded
  | 'cancelled'; // the user chose another sign-in method on the redirect screen

export interface LoginPresentation {
  view: LoginView;
  /** The provider to send the browser to, only for the `redirecting` view. */
  autoRedirectTo: SsoProvider | null;
  blockedBy: AutoRedirectBlock | null;
  /** ?local: show the password section expanded. */
  forceLocal: boolean;
}

export interface LoginGuardState {
  loggedOut: boolean;
  lastAutoRedirectAt: number | null;
  /**
   * sessionStorage (cooldown) and localStorage (logout mark) can both be written. Without them
   * the guards cannot hold, so no auto-redirect.
   */
  storageAvailable: boolean;
}

export interface LoginPresentationInput {
  loginMode: unknown;
  /** Enabled SSO providers, in button order. */
  ssoProviders: SsoProvider[];
  search: string;
  guards: LoginGuardState;
  cancelled?: boolean;
  now: number;
}

/** Long enough to cover a bounce back from the identity provider, short enough not to annoy. */
export const AUTO_REDIRECT_COOLDOWN_MS = 2 * 60 * 1000;
/** How long a logout keeps every tab from signing straight back in through the provider. */
export const LOGOUT_GUARD_MS = 5 * 60 * 1000;

// Shared by all tabs (localStorage): a logout in one tab holds the others too
export const LOGGED_OUT_AT_KEY = 'mcphub.login.loggedOutAt';
// Per tab (sessionStorage): the redirect loop breaker
export const AUTO_REDIRECT_AT_KEY = 'mcphub.login.autoRedirectAt';

const normalizeLoginMode = (value: unknown): LoginMode =>
  value === 'sso_first' || value === 'sso_redirect' ? value : 'dual';

export const decideLoginPresentation = ({
  loginMode,
  ssoProviders,
  search,
  guards,
  cancelled = false,
  now,
}: LoginPresentationInput): LoginPresentation => {
  const params = new URLSearchParams(search);
  const forceLocal = params.has('local');
  const mode = ssoProviders.length === 0 ? 'dual' : normalizeLoginMode(loginMode);

  if (mode === 'dual') return { view: 'dual', autoRedirectTo: null, blockedBy: null, forceLocal };
  const ssoFirst = (blockedBy: AutoRedirectBlock | null): LoginPresentation => ({
    view: 'sso_first',
    autoRedirectTo: null,
    blockedBy,
    forceLocal,
  });
  if (mode === 'sso_first' || ssoProviders.length !== 1) return ssoFirst(null);

  // sso_redirect: every guard below must pass before leaving the page on the user's behalf
  if (forceLocal) return ssoFirst('local');
  if (params.has('error')) return ssoFirst('error');
  // A ?returnUrl (OAuth authorization, service link) does not stop the redirect: it travels
  // through the provider as the callback path. ?error on the way back does stop it.
  if (cancelled) return ssoFirst('cancelled');
  if (guards.loggedOut) return ssoFirst('loggedOut');
  if (!guards.storageAvailable) return ssoFirst('noStorage');
  if (
    guards.lastAutoRedirectAt !== null &&
    now - guards.lastAutoRedirectAt >= 0 &&
    now - guards.lastAutoRedirectAt < AUTO_REDIRECT_COOLDOWN_MS
  ) {
    return ssoFirst('recentAttempt');
  }
  return { view: 'redirecting', autoRedirectTo: ssoProviders[0], blockedBy: null, forceLocal };
};

// Browser storage may be unavailable (blocked storage, some embedded browsers): every access is
// wrapped. Unavailable storage fails safe: readLoginGuards reports it and the page does not
// auto-redirect at all, because the marks that stop a loop could not be recorded.
type StorageKind = 'sessionStorage' | 'localStorage';

const storage = (kind: StorageKind): Storage | null => {
  try {
    return typeof window !== 'undefined' ? window[kind] : null;
  } catch {
    return null;
  }
};

const write = (kind: StorageKind, key: string, value: string | null): boolean => {
  try {
    const store = storage(kind);
    if (!store) return false;
    if (value === null) store.removeItem(key);
    else store.setItem(key, value);
    return store.getItem(key) === value;
  } catch {
    return false;
  }
};

const read = (kind: StorageKind, key: string): string | null => {
  try {
    return storage(kind)?.getItem(key) ?? null;
  } catch {
    return null;
  }
};

const PROBE_KEY = 'mcphub.login.probe';
const writable = (kind: StorageKind): boolean => {
  const ok = write(kind, PROBE_KEY, '1');
  write(kind, PROBE_KEY, null);
  return ok;
};

const timestamp = (value: string | null): number | null => {
  const at = Number(value);
  return Number.isFinite(at) && at > 0 ? at : null;
};

export const readLoginGuards = (now: number = Date.now()): LoginGuardState => {
  const loggedOutAt = timestamp(read('localStorage', LOGGED_OUT_AT_KEY));
  return {
    // A mark from the future (clock change) is ignored rather than holding forever
    loggedOut: loggedOutAt !== null && now >= loggedOutAt && now - loggedOutAt < LOGOUT_GUARD_MS,
    lastAutoRedirectAt: timestamp(read('sessionStorage', AUTO_REDIRECT_AT_KEY)),
    storageAvailable: writable('sessionStorage') && writable('localStorage'),
  };
};

/**
 * Set on logout, in every tab's view, so no login page signs the user straight back in through
 * the provider for five minutes. MCPHub does not sign out of the provider itself.
 */
export const markLoggedOut = (now: number = Date.now()): void => {
  write('localStorage', LOGGED_OUT_AT_KEY, String(now));
};

/** Cleared on any successful sign-in, or when the user starts SSO on purpose. */
export const clearLoggedOut = (): void => {
  write('localStorage', LOGGED_OUT_AT_KEY, null);
};

/**
 * Recorded before every automatic redirect. It is deliberately not cleared on sign-in, so a
 * sign-in that succeeds at the provider but bounces back to the login page cannot loop.
 * Returns false when it could not be stored; the caller must then not redirect.
 */
export const recordAutoRedirect = (now: number): boolean =>
  write('sessionStorage', AUTO_REDIRECT_AT_KEY, String(now));
