import {
  AUTO_REDIRECT_COOLDOWN_MS,
  clearLoggedOut,
  decideLoginPresentation,
  markLoggedOut,
  readLoginGuards,
  recordAutoRedirect,
  type LoginPresentationInput,
} from '../../frontend/src/utils/loginPresentation';

const NOW = 1_700_000_000_000;
const decide = (overrides: Partial<LoginPresentationInput> = {}) =>
  decideLoginPresentation({
    loginMode: 'sso_redirect',
    ssoProviders: ['oidc'],
    search: '',
    guards: { loggedOut: false, lastAutoRedirectAt: null },
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
    ['?returnUrl=%2Foauth%2Fauthorize%3Fclient_id%3Dx', 'returnUrl'],
    ['?returnUrl=%2Fservices%2Fdemo', 'returnUrl'],
  ])('does not redirect with %s', (search, blockedBy) => {
    expect(decide({ search })).toMatchObject({
      view: 'sso_first',
      autoRedirectTo: null,
      blockedBy,
    });
  });

  it('expands the password section with ?local in every mode', () => {
    for (const loginMode of ['dual', 'sso_first', 'sso_redirect']) {
      expect(decide({ loginMode, search: '?local=1' }).forceLocal).toBe(true);
    }
  });

  it('does not redirect after logout in this tab', () => {
    expect(decide({ guards: { loggedOut: true, lastAutoRedirectAt: null } })).toMatchObject({
      view: 'sso_first',
      blockedBy: 'loggedOut',
    });
  });

  it('does not redirect after the user cancelled the redirect', () => {
    expect(decide({ cancelled: true })).toMatchObject({
      view: 'sso_first',
      blockedBy: 'cancelled',
    });
  });

  it('redirects at most once per cooldown in the same tab', () => {
    const at = (offset: number) =>
      decide({ guards: { loggedOut: false, lastAutoRedirectAt: NOW - offset } });
    expect(at(1000)).toMatchObject({ view: 'sso_first', blockedBy: 'recentAttempt' });
    expect(at(AUTO_REDIRECT_COOLDOWN_MS - 1).blockedBy).toBe('recentAttempt');
    expect(at(AUTO_REDIRECT_COOLDOWN_MS).view).toBe('redirecting');
    // A timestamp from the future (clock change) does not block forever
    expect(at(-5000).view).toBe('redirecting');
  });
});

describe('login guards in sessionStorage', () => {
  const store = new Map<string, string>();
  const sessionStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  };

  beforeEach(() => {
    store.clear();
    (globalThis as { window?: unknown }).window = { sessionStorage };
  });

  afterAll(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it('starts with no guard set', () => {
    expect(readLoginGuards()).toEqual({ loggedOut: false, lastAutoRedirectAt: null });
  });

  it('remembers a logout until it is cleared', () => {
    markLoggedOut();
    expect(readLoginGuards().loggedOut).toBe(true);
    clearLoggedOut();
    expect(readLoginGuards().loggedOut).toBe(false);
  });

  it('records the last automatic redirect, and keeps it when the logout flag is cleared', () => {
    recordAutoRedirect(NOW);
    clearLoggedOut();
    expect(readLoginGuards().lastAutoRedirectAt).toBe(NOW);
  });

  it('reads unavailable storage as no guard, without throwing', () => {
    (globalThis as { window?: unknown }).window = {
      get sessionStorage() {
        throw new Error('SecurityError');
      },
    };
    expect(() => markLoggedOut()).not.toThrow();
    expect(readLoginGuards()).toEqual({ loggedOut: false, lastAutoRedirectAt: null });
  });
});
