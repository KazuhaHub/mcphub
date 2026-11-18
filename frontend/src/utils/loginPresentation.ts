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
  | 'returnUrl' // a return target (OAuth consent, service link) is in progress
  | 'loggedOut' // the user signed out in this tab
  | 'recentAttempt' // this tab already auto-redirected a moment ago
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

const LOGGED_OUT_KEY = 'mcphub.login.loggedOut';
const AUTO_REDIRECT_AT_KEY = 'mcphub.login.autoRedirectAt';

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
  if (params.has('returnUrl')) return ssoFirst('returnUrl');
  if (cancelled) return ssoFirst('cancelled');
  if (guards.loggedOut) return ssoFirst('loggedOut');
  if (
    guards.lastAutoRedirectAt !== null &&
    now - guards.lastAutoRedirectAt >= 0 &&
    now - guards.lastAutoRedirectAt < AUTO_REDIRECT_COOLDOWN_MS
  ) {
    return ssoFirst('recentAttempt');
  }
  return { view: 'redirecting', autoRedirectTo: ssoProviders[0], blockedBy: null, forceLocal };
};

// sessionStorage is per tab and may be unavailable (private mode, blocked storage): every access
// is wrapped, and a failure reads as "no guard set", which only ever means one extra redirect.
const storage = (): Storage | null => {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
};

const write = (key: string, value: string | null): void => {
  try {
    const store = storage();
    if (!store) return;
    if (value === null) store.removeItem(key);
    else store.setItem(key, value);
  } catch {
    // ignore
  }
};

export const readLoginGuards = (): LoginGuardState => {
  try {
    const store = storage();
    const at = Number(store?.getItem(AUTO_REDIRECT_AT_KEY));
    return {
      loggedOut: store?.getItem(LOGGED_OUT_KEY) === '1',
      lastAutoRedirectAt: Number.isFinite(at) && at > 0 ? at : null,
    };
  } catch {
    return { loggedOut: false, lastAutoRedirectAt: null };
  }
};

/** Set on logout, so the login page that follows does not sign the user straight back in. */
export const markLoggedOut = (): void => write(LOGGED_OUT_KEY, '1');

/** Cleared once the user signs in or starts SSO on purpose. */
export const clearLoggedOut = (): void => write(LOGGED_OUT_KEY, null);

/**
 * Recorded before every automatic redirect. It is deliberately not cleared on sign-in, so a
 * sign-in that succeeds at the provider but bounces back to the login page cannot loop.
 */
export const recordAutoRedirect = (now: number): void => write(AUTO_REDIRECT_AT_KEY, String(now));
