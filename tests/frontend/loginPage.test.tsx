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
jest.mock('@/utils/appVersion', () => ({ APP_VERSION: 'test' }));
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

const mockStartOidcLogin = jest.fn();
jest.mock('../../frontend/src/services/betterAuthClient', () => ({
  startOidcLogin: (options: unknown) => mockStartOidcLogin(options),
  createBetterAuthClient: jest.fn(),
}));

const LOGGED_OUT_KEY = 'mcphub.login.loggedOut';
const AUTO_REDIRECT_AT_KEY = 'mcphub.login.autoRedirectAt';

const publicConfig = (loginMode: string) => ({
  skipAuth: false,
  allowRegistration: false,
  betterAuth: {
    enabled: true,
    basePath: '/api/auth/better',
    disablePasswordLogin: false,
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
    window.sessionStorage.setItem(LOGGED_OUT_KEY, '1');
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
    expect(window.sessionStorage.getItem(LOGGED_OUT_KEY)).toBeNull();
  });

  it('clears the logout mark when the user starts SSO on purpose', async () => {
    window.sessionStorage.setItem(LOGGED_OUT_KEY, '1');
    await renderPage();
    await act(async () => {
      fireEvent.click(screen.getByTestId('login-sso-oidc'));
    });
    expect(mockStartOidcLogin).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem(LOGGED_OUT_KEY)).toBeNull();
  });
});
