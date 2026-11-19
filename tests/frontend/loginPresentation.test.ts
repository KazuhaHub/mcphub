import {
  AUTO_REDIRECT_COOLDOWN_MS,
  clearLoggedOut,
  decideLoginPresentation,
  markLoggedOut,
  readLoginGuards,
  recordAutoRedirect,
  AUTO_REDIRECT_AT_KEY,
  LOGGED_OUT_AT_KEY,
  LOGOUT_GUARD_MS,
  type LoginPresentationInput,
} from '../../frontend/src/utils/loginPresentation';

const NOW = 1_700_000_000_000;
const decide = (overrides: Partial<LoginPresentationInput> = {}) =>
  decideLoginPresentation({
    loginMode: 'sso_redirect',
    ssoProviders: ['oidc'],
    search: '',
    guards: { loggedOut: false, lastAutoRedirectAt: null, storageAvailable: true },
    now: NOW,
    ...overrides,
  });

describe('decideLoginPresentation', () => {
  it.each([undefined, 'dual', 'popup', 42])('keeps the original layout for %p', (loginMode) => {
    expect(decide({ loginMode })).toEqual({
      view: 'dual',
      autoRedirectTo: null,
      blockedBy: null,
      forceLocal: false,
    });
  });

  it.each(['sso_first', 'sso_redirect'])(
    'uses the original layout without any SSO provider (%s)',
    (loginMode) => {
      expect(decide({ loginMode, ssoProviders: [] }).view).toBe('dual');
    },
  );

  it('puts SSO first without redirecting in sso_first', () => {
    expect(decide({ loginMode: 'sso_first' })).toMatchObject({
      view: 'sso_first',
      autoRedirectTo: null,
    });
  });

  it('redirects to the single provider when no guard applies', () => {
    expect(decide()).toEqual({
      view: 'redirecting',
      autoRedirectTo: 'oidc',
      blockedBy: null,
      forceLocal: false,
    });
  });

  it('does not pick a provider when there is more than one', () => {
    expect(decide({ ssoProviders: ['oidc', 'github'] })).toMatchObject({
      view: 'sso_first',
      autoRedirectTo: null,
      blockedBy: null,
    });
  });

  it.each([
    ['?local=1', 'local'],
    ['?local', 'local'],
    ['?error=access_denied', 'error'],
    ['?returnUrl=%2Foauth%2Fauthorize%3Fclient_id%3Dx&error=access_denied', 'error'],
  ])('does not redirect with %s', (search, blockedBy) => {
    expect(decide({ search })).toMatchObject({
      view: 'sso_first',
      autoRedirectTo: null,
      blockedBy,
    });
  });

  it.each(['?returnUrl=%2Foauth%2Fauthorize%3Fclient_id%3Dx', '?returnUrl=%2Fservices%2Fdemo'])(
    'still redirects with %s, which travels as the callback path',
    (search) => {
      expect(decide({ search })).toMatchObject({ view: 'redirecting', autoRedirectTo: 'oidc' });
    },
  );

  it('expands the password section with ?local in every mode', () => {
    for (const loginMode of ['dual', 'sso_first', 'sso_redirect']) {
      expect(decide({ loginMode, search: '?local=1' }).forceLocal).toBe(true);
    }
  });

  it('does not redirect after logout in this tab', () => {
    expect(
      decide({ guards: { loggedOut: true, lastAutoRedirectAt: null, storageAvailable: true } }),
    ).toMatchObject({
      view: 'sso_first',
      blockedBy: 'loggedOut',
    });
  });

  it('does not redirect when the cooldown cannot be stored', () => {
    expect(
      decide({ guards: { loggedOut: false, lastAutoRedirectAt: null, storageAvailable: false } }),
    ).toMatchObject({ view: 'sso_first', autoRedirectTo: null, blockedBy: 'noStorage' });
  });

  it('does not redirect after the user cancelled the redirect', () => {
    expect(decide({ cancelled: true })).toMatchObject({
      view: 'sso_first',
      blockedBy: 'cancelled',
    });
  });

  it('redirects at most once per cooldown in the same tab', () => {
    const at = (offset: number) =>
      decide({
        guards: { loggedOut: false, lastAutoRedirectAt: NOW - offset, storageAvailable: true },
      });
    expect(at(1000)).toMatchObject({ view: 'sso_first', blockedBy: 'recentAttempt' });
    expect(at(AUTO_REDIRECT_COOLDOWN_MS - 1).blockedBy).toBe('recentAttempt');
    expect(at(AUTO_REDIRECT_COOLDOWN_MS).view).toBe('redirecting');
    // A timestamp from the future (clock change) does not block forever
    expect(at(-5000).view).toBe('redirecting');
  });
});

describe('login guards in browser storage', () => {
  const makeStore = () => {
    const map = new Map<string, string>();
    return {
      map,
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => void map.set(key, value),
      removeItem: (key: string) => void map.delete(key),
    };
  };
  let session = makeStore();
  let local = makeStore();
  const throwing = {
    getItem: () => null,
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
    removeItem: () => undefined,
  };

  beforeEach(() => {
    session = makeStore();
    local = makeStore();
    (globalThis as { window?: unknown }).window = { sessionStorage: session, localStorage: local };
  });

  afterAll(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it('starts with no guard set', () => {
    expect(readLoginGuards(NOW)).toEqual({
      loggedOut: false,
      lastAutoRedirectAt: null,
      storageAvailable: true,
    });
  });

  it('keeps the logout mark in localStorage, shared by every tab, until it is cleared', () => {
    markLoggedOut(NOW);
    expect(local.map.get(LOGGED_OUT_AT_KEY)).toBe(String(NOW));
    expect(session.map.size).toBe(0);
    expect(readLoginGuards(NOW + 1000).loggedOut).toBe(true);
    clearLoggedOut();
    expect(readLoginGuards(NOW + 1000).loggedOut).toBe(false);
  });

  it('lets the logout mark lapse after five minutes, and ignores one from the future', () => {
    markLoggedOut(NOW);
    expect(readLoginGuards(NOW + LOGOUT_GUARD_MS - 1).loggedOut).toBe(true);
    expect(readLoginGuards(NOW + LOGOUT_GUARD_MS).loggedOut).toBe(false);
    expect(readLoginGuards(NOW - 60_000).loggedOut).toBe(false);
  });

  it('records the last automatic redirect per tab, and keeps it when the logout mark is cleared', () => {
    expect(recordAutoRedirect(NOW)).toBe(true);
    expect(session.map.get(AUTO_REDIRECT_AT_KEY)).toBe(String(NOW));
    clearLoggedOut();
    expect(readLoginGuards(NOW).lastAutoRedirectAt).toBe(NOW);
  });

  it('reports unavailable storage, without throwing, and refuses to record a redirect', () => {
    (globalThis as { window?: unknown }).window = {
      get sessionStorage() {
        throw new Error('SecurityError');
      },
      get localStorage() {
        throw new Error('SecurityError');
      },
    };
    expect(() => markLoggedOut(NOW)).not.toThrow();
    expect(readLoginGuards(NOW)).toEqual({
      loggedOut: false,
      lastAutoRedirectAt: null,
      storageAvailable: false,
    });
    expect(recordAutoRedirect(NOW)).toBe(false);
  });

  it('treats sessionStorage that throws on write as unavailable', () => {
    (globalThis as { window?: unknown }).window = { sessionStorage: throwing, localStorage: local };
    expect(readLoginGuards(NOW).storageAvailable).toBe(false);
    expect(recordAutoRedirect(NOW)).toBe(false);
  });

  it('treats localStorage that cannot hold the logout mark as unavailable', () => {
    (globalThis as { window?: unknown }).window = {
      sessionStorage: session,
      localStorage: throwing,
    };
    expect(readLoginGuards(NOW).storageAvailable).toBe(false);
  });
});
