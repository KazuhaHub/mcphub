import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import LoginMethods, { type LoginMethodsProps } from '../../frontend/src/components/LoginMethods';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, string>) => (vars?.name ? `${key}:${vars.name}` : key),
  }),
}));

const noop = () => undefined;
const render = (overrides: Partial<LoginMethodsProps> = {}) =>
  renderToStaticMarkup(
    createElement(LoginMethods, {
      view: 'dual',
      blockedBy: null,
      passwordAllowed: true,
      passwordExpanded: false,
      passwordForm: createElement('form', { 'data-testid': 'password-form' }),
      showPasskey: true,
      providers: { oidc: true, google: false, github: false },
      redirectProvider: null,
      socialLoading: null,
      loading: false,
      socialError: null,
      onSocialLogin: noop,
      onPasskeyLogin: noop,
      onExpandPassword: noop,
      onCancelRedirect: noop,
      ...overrides,
    }),
  );
const testIds = (html: string) => [...html.matchAll(/data-testid="([a-z-]+)"/g)].map((m) => m[1]);
const oidcButton = (html: string) =>
  /<button[^>]*data-testid="login-sso-oidc"[^>]*>/.exec(html)![0];

describe('LoginMethods', () => {
  describe('dual (the original layout)', () => {
    it('shows the password form, then passkey and SSO below the divider', () => {
      const html = render();
      expect(testIds(html)).toEqual(['password-form', 'login-passkey', 'login-sso-oidc']);
      expect(html).toContain('auth.orContinue');
      expect(html).toContain('auth.loginWithOIDC');
      expect(oidcButton(html)).not.toContain('primary');
    });

    it('shows only SSO when password login is disabled', () => {
      const html = render({ passwordAllowed: false, showPasskey: false });
      expect(testIds(html)).toEqual(['login-sso-oidc']);
      expect(html).not.toContain('auth.orContinue');
    });

    it('labels the OIDC button with the configured name', () => {
      expect(render({ oidcDisplayName: 'Microsoft Entra ID' })).toContain(
        'auth.loginWithProvider:Microsoft Entra ID',
      );
    });

    it('renders the configured name as text, not markup', () => {
      const html = render({ oidcDisplayName: '<img src=x onerror=alert(1)>' });
      expect(html).not.toContain('<img');
      expect(html).toContain('&lt;img');
    });
  });

  describe('sso_first', () => {
    it('puts SSO first as the main action and folds the password form behind a link', () => {
      const html = render({ view: 'sso_first' });
      expect(testIds(html)).toEqual(['login-sso-oidc', 'login-show-password']);
      expect(oidcButton(html)).toContain('primary');
      expect(html).toContain('auth.usePasswordInstead');
    });

    it('shows the password form and passkey once expanded', () => {
      const html = render({ view: 'sso_first', passwordExpanded: true });
      expect(testIds(html)).toEqual([
        'login-sso-oidc',
        'login-password-section',
        'password-form',
        'login-passkey',
      ]);
      expect(html).not.toContain('login-show-password');
    });

    it('offers no password link at all when password login is disabled', () => {
      const html = render({ view: 'sso_first', passwordAllowed: false, passwordExpanded: true });
      expect(testIds(html)).toEqual(['login-sso-oidc']);
    });

    it.each([
      ['loggedOut', 'auth.ssoRedirectPausedLoggedOut'],
      ['recentAttempt', 'auth.ssoRedirectPausedLoop'],
    ] as const)('explains why it did not redirect (%s)', (blockedBy, note) => {
      expect(render({ view: 'sso_first', blockedBy })).toContain(note);
    });

    it.each(['local', 'returnUrl', 'cancelled'] as const)('adds no note for %s', (blockedBy) => {
      expect(render({ view: 'sso_first', blockedBy })).not.toContain('login-redirect-note');
    });

    it('shows the SSO error above the buttons', () => {
      const html = render({ view: 'sso_first', blockedBy: 'error', socialError: 'SSO failed' });
      expect(html.indexOf('SSO failed')).toBeLessThan(html.indexOf('login-sso-oidc'));
    });
  });

  describe('redirecting', () => {
    it('shows the provider it is going to and a way out, without the form', () => {
      const html = render({
        view: 'redirecting',
        redirectProvider: 'oidc',
        oidcDisplayName: 'Microsoft Entra ID',
      });
      expect(html).toContain('auth.redirectingToSso:Microsoft Entra ID');
      expect(testIds(html)).toEqual(['login-cancel-redirect']);
    });

    it('names a provider without a display name generically', () => {
      expect(render({ view: 'redirecting', redirectProvider: 'oidc' })).toContain(
        'auth.redirectingToSso:auth.ssoProviderFallback',
      );
      expect(render({ view: 'redirecting', redirectProvider: 'github' })).toContain(
        'auth.redirectingToSso:GitHub',
      );
    });
  });
});
