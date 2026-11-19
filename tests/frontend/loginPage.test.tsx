/**
 * @jest-environment jsdom
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import LoginPage from '../../frontend/src/pages/LoginPage';

// react-router needs TextEncoder, which jsdom lacks; the page only reads the location
let mockSearch = '';
const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: '/login', search: mockSearch, hash: '', state: null }),
  useNavigate: () => mockNavigate,
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, string>) => (vars?.name ? `${key}:${vars.name}` : key),
  }),
}));
jest.mock('@/contexts/BrandingContext', () => ({ useBranding: () => ({ dashboardTitle: 'Hub' }) }));
jest.mock('@/components/BrandMark', () => ({ BrandMark: () => null, useBrandLogo: () => '' }));
jest.mock('@/components/ui/ThemeSwitch', () => () => null);
jest.mock('@/components/ui/LanguageSwitch', () => () => null);
jest.mock('@/components/ui/DefaultPasswordWarningModal', () => () => null);
jest.mock('../../frontend/src/utils/runtime', () => ({ getBasePath: () => '' }));
jest.mock('../../frontend/src/services/passkeyService', () => ({ passkeysSupported: () => false }));

const mockLogin = jest.fn();
const mockAuth = { isAuthenticated: false, loading: false, user: null, error: null };
jest.mock('../../frontend/src/contexts/AuthContext', () => ({
  useAuth: () => ({
    auth: mockAuth,
    login: mockLogin,
    loginWithPasskey: jest.fn(),
    register: jest.fn(),
    logout: jest.fn(),
  }),
}));

const mockGetPublicConfig = jest.fn();
jest.mock('../../frontend/src/services/configService', () => ({
  getPublicConfig: () => mockGetPublicConfig(),
}));

const mockHardNavigate = jest.fn();
jest.mock('../../frontend/src/utils/hardNavigate', () => ({
  hardNavigate: (url: string) => mockHardNavigate(url),
}));

const mockStartOidcLogin = jest.fn();
jest.mock('../../frontend/src/services/betterAuthClient', () => ({
  startOidcLogin: (options: unknown) => mockStartOidcLogin(options),
  createBetterAuthClient: jest.fn(),
}));

const LOGGED_OUT_AT_KEY = 'mcphub.login.loggedOutAt';
const AUTO_REDIRECT_AT_KEY = 'mcphub.login.autoRedirectAt';

const publicConfig = (loginMode: string, disablePasswordLogin = false) => ({
  skipAuth: false,
  allowRegistration: false,
  betterAuth: {
    enabled: true,
    basePath: '/api/auth/better',
    disablePasswordLogin,
    loginMode,
    providers: {
      google: { enabled: false },
      github: { enabled: false },
      oidc: { enabled: true, providerId: 'entra', displayName: 'Microsoft Entra ID' },
    },
  },
});

const renderPage = async (search = '') => {
  mockSearch = search;
  render(<LoginPage />);
  // Let the public config promise settle
  await act(async () => {});
};
const advance = async (ms: number) => {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
  await act(async () => {});
};
const view = () => document.querySelector('[data-login-view]')?.getAttribute('data-login-view');
const pageShow = async () => {
  const event = new Event('pageshow');
  Object.defineProperty(event, 'persisted', { value: true });
  await act(async () => {
    window.dispatchEvent(event);
  });
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  window.sessionStorage.clear();
  window.localStorage.clear();
  mockGetPublicConfig.mockResolvedValue(publicConfig('sso_redirect'));
  // By default the sign-in request stays in flight, as while the browser leaves the page
  mockStartOidcLogin.mockReturnValue(new Promise(() => undefined));
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('LoginPage', () => {
  it('shows the password form before the public config arrives, and keeps it if it never does', async () => {
    mockGetPublicConfig.mockReturnValue(new Promise(() => undefined));
    await renderPage();
    expect(view()).toBe('dual');
    expect(screen.getByLabelText('auth.username')).toBeTruthy();
    await advance(5000);
    expect(mockStartOidcLogin).not.toHaveBeenCalled();
  });

  it('keeps the password form when the public config fails', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockGetPublicConfig.mockRejectedValue(new Error('offline'));
    await renderPage();
    expect(view()).toBe('dual');
    expect(screen.getByLabelText('auth.password')).toBeTruthy();
  });

  it('redirects to the single provider after the pause, records it, and hides the cancel button', async () => {
    await renderPage();
    expect(screen.getByText('auth.redirectingToSso:Microsoft Entra ID')).toBeTruthy();
    expect(screen.getByTestId('login-cancel-redirect')).toBeTruthy();

    await advance(1000);
    expect(mockStartOidcLogin).toHaveBeenCalledTimes(1);
    expect(mockStartOidcLogin).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'entra',
        callbackURL: '/',
        errorCallbackURL: '/login',
      }),
    );
    expect(Number(window.sessionStorage.getItem(AUTO_REDIRECT_AT_KEY))).toBeGreaterThan(0);
    // The request is out: a cancel button could no longer stop it
    expect(screen.queryByTestId('login-cancel-redirect')).toBeNull();
  });

  it('cancels the redirect from the button before the pause ends', async () => {
    await renderPage();
    fireEvent.click(screen.getByTestId('login-cancel-redirect'));
    await advance(5000);
    expect(mockStartOidcLogin).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(AUTO_REDIRECT_AT_KEY)).toBeNull();
    expect(view()).toBe('sso_first');
    expect(screen.getByTestId('login-sso-oidc')).toBeTruthy();
  });

  it('falls back to the buttons, once, when the automatic start fails', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockStartOidcLogin.mockRejectedValue(new Error('IdP down'));
    await renderPage();
    await advance(1000);
    expect(mockStartOidcLogin).toHaveBeenCalledTimes(1);
    expect(view()).toBe('sso_first');
    expect(screen.getByText('auth.socialLoginFailed')).toBeTruthy();
    expect(screen.queryByText(/auth.redirectingToSso/)).toBeNull();
    await advance(10000);
    expect(mockStartOidcLogin).toHaveBeenCalledTimes(1);
  });

  it('does not redirect when sessionStorage cannot record the cooldown', async () => {
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    await renderPage();
    await advance(5000);
    expect(mockStartOidcLogin).not.toHaveBeenCalled();
    expect(view()).toBe('sso_first');
  });

  describe('restored from the back/forward cache', () => {
    it('shows the buttons, not a stuck spinner, within the cooldown', async () => {
      await renderPage();
      await advance(1000);
      expect(mockStartOidcLogin).toHaveBeenCalledTimes(1);

      await pageShow();
      await advance(5000);
      expect(mockStartOidcLogin).toHaveBeenCalledTimes(1);
      expect(view()).toBe('sso_first');
      expect(screen.getByText('auth.ssoRedirectPausedLoop')).toBeTruthy();
      expect(screen.queryByText(/auth.redirectingToSso/)).toBeNull();
    });

    it('redirects again once the cooldown has passed', async () => {
      await renderPage();
      await advance(1000);
      expect(mockStartOidcLogin).toHaveBeenCalledTimes(1);

      window.sessionStorage.setItem(AUTO_REDIRECT_AT_KEY, String(Date.now() - 3 * 60 * 1000));
      await pageShow();
      expect(view()).toBe('redirecting');
      await advance(1000);
      expect(mockStartOidcLogin).toHaveBeenCalledTimes(2);
    });
  });

  it('does not redirect after logout, and clears the logout mark on a successful sign-in', async () => {
    window.localStorage.setItem(LOGGED_OUT_AT_KEY, String(Date.now()));
    mockLogin.mockResolvedValue({ success: true });
    await renderPage();
    await advance(5000);
    expect(mockStartOidcLogin).not.toHaveBeenCalled();
    expect(screen.getByText('auth.ssoRedirectPausedLoggedOut')).toBeTruthy();

    fireEvent.click(screen.getByTestId('login-show-password'));
    fireEvent.change(screen.getByLabelText('auth.username'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText('auth.password'), { target: { value: 'secret' } });
    await act(async () => {
      fireEvent.submit(screen.getByLabelText('auth.username').closest('form')!);
    });
    expect(mockLogin).toHaveBeenCalledWith('admin', 'secret');
    expect(window.localStorage.getItem(LOGGED_OUT_AT_KEY)).toBeNull();
  });

  it('lets a logout mark older than five minutes lapse', async () => {
    window.localStorage.setItem(LOGGED_OUT_AT_KEY, String(Date.now() - 6 * 60 * 1000));
    await renderPage();
    await advance(1000);
    expect(mockStartOidcLogin).toHaveBeenCalledTimes(1);
  });

  it('does not redirect when localStorage cannot hold the logout mark', async () => {
    const original = Storage.prototype.setItem;
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key,
      value,
    ) {
      if (this === window.localStorage) throw new Error('QuotaExceededError');
      original.call(this, key, value);
    });
    await renderPage();
    await advance(5000);
    expect(mockStartOidcLogin).not.toHaveBeenCalled();
    expect(view()).toBe('sso_first');
  });

  it.each(['/.//evil.example', 'http://localhost//evil.example', '/..//evil.example'])(
    'sends a signed-in visitor to the dashboard, not off-site, for %s',
    async (target) => {
      mockAuth.isAuthenticated = true;
      try {
        await renderPage(`?returnUrl=${encodeURIComponent(target)}`);
        expect(mockHardNavigate).not.toHaveBeenCalled();
        expect(mockNavigate).toHaveBeenCalledWith('/');
      } finally {
        mockAuth.isAuthenticated = false;
      }
    },
  );

  it('returns a signed-in visitor to a safe target', async () => {
    mockAuth.isAuthenticated = true;
    try {
      await renderPage(`?returnUrl=${encodeURIComponent('/servers?tab=tools#x')}`);
      expect(mockHardNavigate).toHaveBeenCalledWith('/servers?tab=tools#x');
    } finally {
      mockAuth.isAuthenticated = false;
    }
  });

  describe('OAuth authorization round trip', () => {
    const authorize =
      '/oauth/authorize?client_id=claude&redirect_uri=https%3A%2F%2Fclaude.ai%2Fcb&state=s1';
    const search = `?returnUrl=${encodeURIComponent(`${authorize}&token=stale`)}`;

    it('redirects straight to the provider and returns to the authorize URL, without the token', async () => {
      await renderPage(search);
      expect(view()).toBe('redirecting');
      await advance(1000);
      expect(mockStartOidcLogin).toHaveBeenCalledTimes(1);
      const options = mockStartOidcLogin.mock.calls[0][0] as {
        callbackURL: string;
        errorCallbackURL: string;
      };
      expect(options.callbackURL).toBe(authorize);
      // A failure comes back to the login page with the same target, plus ?error from the server
      expect(options.errorCallbackURL).toBe(`/login?returnUrl=${encodeURIComponent(authorize)}`);
    });

    it('stops on an SSO error on the way back, and the button still carries the target', async () => {
      await renderPage(`${search}&error=access_denied`);
      await advance(5000);
      expect(mockStartOidcLogin).not.toHaveBeenCalled();
      expect(view()).toBe('sso_first');
      expect(screen.getByText('auth.socialLoginFailed')).toBeTruthy();

      await act(async () => {
        fireEvent.click(screen.getByTestId('login-sso-oidc'));
      });
      expect(mockStartOidcLogin).toHaveBeenCalledWith(
        expect.objectContaining({ callbackURL: authorize }),
      );
    });

    it.each([
      'https://evil.example/oauth/authorize',
      '//evil.example/x',
      'javascript:alert(1)',
      '/.//evil.example',
      '/..//evil.example',
      'http://localhost//evil.example',
      '/%5Cevil.example',
    ])('never carries a foreign return target (%s)', async (target) => {
      await renderPage(`?returnUrl=${encodeURIComponent(target)}`);
      await advance(1000);
      expect(mockStartOidcLogin).toHaveBeenCalledWith(
        expect.objectContaining({ callbackURL: '/', errorCallbackURL: '/login' }),
      );
    });
  });

  describe('the unlinked ?local=1 entry while password login is disabled', () => {
    beforeEach(() => {
      mockGetPublicConfig.mockResolvedValue(publicConfig('sso_redirect', true));
    });

    it('shows no password form or link on the normal page', async () => {
      window.localStorage.setItem(LOGGED_OUT_AT_KEY, String(Date.now()));
      await renderPage();
      expect(screen.queryByLabelText('auth.username')).toBeNull();
      expect(screen.queryByTestId('login-show-password')).toBeNull();
    });

    it('shows the password form, does not redirect, and leaves the decision to the server', async () => {
      mockLogin.mockResolvedValue({ success: false, message: 'Password login is disabled.' });
      await renderPage('?local=1');
      await advance(5000);
      expect(mockStartOidcLogin).not.toHaveBeenCalled();
      fireEvent.change(screen.getByLabelText('auth.username'), { target: { value: 'mallory' } });
      fireEvent.change(screen.getByLabelText('auth.password'), { target: { value: 'guess' } });
      await act(async () => {
        fireEvent.submit(screen.getByLabelText('auth.username').closest('form')!);
      });
      expect(mockLogin).toHaveBeenCalledWith('mallory', 'guess');
      // The generic failure, whatever the server's reason
      expect(screen.getByText('auth.loginFailed')).toBeTruthy();
    });
  });

  it('clears the logout mark when the user starts SSO on purpose', async () => {
    window.localStorage.setItem(LOGGED_OUT_AT_KEY, String(Date.now()));
    await renderPage();
    await act(async () => {
      fireEvent.click(screen.getByTestId('login-sso-oidc'));
    });
    expect(mockStartOidcLogin).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(LOGGED_OUT_AT_KEY)).toBeNull();
  });
});
