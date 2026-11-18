import { useBranding } from '@/contexts/BrandingContext';
import { BrandMark, useBrandLogo } from '@/components/BrandMark';
import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BookOpen, AlertCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { getPublicConfig } from '../services/configService';
import { createBetterAuthClient, startOidcLogin } from '../services/betterAuthClient';
import { passkeysSupported } from '../services/passkeyService';
import { getBasePath } from '../utils/runtime';
import { buildOAuthReturnTarget } from '../utils/oauthReturn';
import ThemeSwitch from '@/components/ui/ThemeSwitch';
import LanguageSwitch from '@/components/ui/LanguageSwitch';
import GitHubIcon from '@/components/icons/GitHubIcon';
import DefaultPasswordWarningModal from '@/components/ui/DefaultPasswordWarningModal';
import LoginMethods, { type AlternativeSignIn } from '@/components/LoginMethods';
import { PROJECT_DOCS_URL, PROJECT_REPO_URL } from '@/constants/links';
import { APP_VERSION } from '@/utils/appVersion';
import {
  clearLoggedOut,
  decideLoginPresentation,
  readLoginGuards,
  recordAutoRedirect,
  type SsoProvider,
} from '../utils/loginPresentation';

type SocialProvider = SsoProvider;

const AUTO_REDIRECT_DELAY_MS = 800;

const sanitizeReturnUrl = (value: string | null): string | null => {
  if (!value) return null;
  try {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
    const url = new URL(value, origin);
    if (url.origin !== origin) return null;
    const relativePath = `${url.pathname}${url.search}${url.hash}`;
    return relativePath || '/';
  } catch {
    if (value.startsWith('/') && !value.startsWith('//')) return value;
    return null;
  }
};

const LoginPage: React.FC = () => {
  const { t } = useTranslation();
  const { dashboardTitle } = useBranding();
  const brandLogo = useBrandLogo();
  const [allowRegistration, setAllowRegistration] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [socialLoading, setSocialLoading] = useState<AlternativeSignIn | null>(null);
  const [socialError, setSocialError] = useState<string | null>(null);
  const [betterAuthBasePath, setBetterAuthBasePath] = useState<string | undefined>(undefined);
  // Set from the public config: only SSO sign-in is offered
  const [passwordLoginDisabled, setPasswordLoginDisabled] = useState(false);
  const [socialProviders, setSocialProviders] = useState({
    google: false,
    github: false,
    oidc: false,
  });
  const [oidcProviderId, setOidcProviderId] = useState<string>('oidc');
  const [oidcDisplayName, setOidcDisplayName] = useState<string | undefined>(undefined);
  const [loginMode, setLoginMode] = useState<string>('dual');
  // Until the public config arrives (or if it never does) the page shows the original layout;
  // automatic redirect waits for it
  const [configLoaded, setConfigLoaded] = useState(false);
  const [guards, setGuards] = useState(readLoginGuards);
  const [redirectCancelled, setRedirectCancelled] = useState(false);
  const [passwordExpanded, setPasswordExpanded] = useState(false);
  const autoRedirectStarted = useRef(false);
  const [showDefaultPasswordWarning, setShowDefaultPasswordWarning] = useState(false);
  const { login, loginWithPasskey, register, auth } = useAuth();
  const [passkeySupport] = useState(passkeysSupported);
  const location = useLocation();
  const navigate = useNavigate();
  const returnUrl = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return sanitizeReturnUrl(params.get('returnUrl'));
  }, [location.search]);

  const isServerUnavailableError = useCallback((message?: string) => {
    if (!message) return false;
    const normalized = message.toLowerCase();
    return (
      normalized.includes('failed to fetch') ||
      normalized.includes('networkerror') ||
      normalized.includes('network error') ||
      normalized.includes('connection refused') ||
      normalized.includes('unable to connect') ||
      normalized.includes('fetch error') ||
      normalized.includes('econnrefused') ||
      normalized.includes('http 500') ||
      normalized.includes('internal server error') ||
      normalized.includes('proxy error')
    );
  }, []);

  const redirectAfterLogin = useCallback(() => {
    clearLoggedOut();
    if (returnUrl) {
      window.location.assign(buildOAuthReturnTarget(returnUrl));
    } else {
      navigate('/');
    }
  }, [navigate, returnUrl]);

  useEffect(() => {
    if (!auth.loading && auth.isAuthenticated) redirectAfterLogin();
  }, [auth.isAuthenticated, auth.loading, redirectAfterLogin]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const errorCode = params.get('error');
    if (errorCode) {
      const i18nKey = `auth.error.${errorCode}`;
      const translated = t(i18nKey);
      setSocialError(translated !== i18nKey ? translated : t('auth.socialLoginFailed'));
    }
  }, [location.search, t]);

  useEffect(() => {
    const loadAuthProviders = async () => {
      try {
        const publicConfig = await getPublicConfig();
        setAllowRegistration(publicConfig.allowRegistration === true);
        const betterAuth = publicConfig.betterAuth;
        if (!betterAuth?.enabled) {
          setSocialProviders({ google: false, github: false, oidc: false });
          return;
        }
        setBetterAuthBasePath(betterAuth.basePath);
        setPasswordLoginDisabled(betterAuth.disablePasswordLogin === true);
        setOidcProviderId(betterAuth.providers?.oidc?.providerId || 'oidc');
        setOidcDisplayName(betterAuth.providers?.oidc?.displayName || undefined);
        setLoginMode(betterAuth.loginMode || 'dual');
        setSocialProviders({
          google: betterAuth.providers?.google?.enabled === true,
          github: betterAuth.providers?.github?.enabled === true,
          oidc: betterAuth.providers?.oidc?.enabled === true,
        });
      } catch (err) {
        // Keep the original layout with the password form; there is nothing to redirect to
        console.error('Failed to load the login configuration:', err);
      } finally {
        setConfigLoaded(true);
      }
    };
    loadAuthProviders();
  }, []);

  // Back from the identity provider restores this page from the back/forward cache with the
  // redirect screen still up: re-read the guards (the redirect was recorded) and reset it
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      // Allow one more automatic redirect: the new guards decide whether it happens (it does not
      // within the cooldown), so the redirect screen never stays up without navigating
      autoRedirectStarted.current = false;
      setGuards(readLoginGuards());
      setSocialLoading(null);
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  const presentation = useMemo(
    () =>
      decideLoginPresentation({
        loginMode,
        ssoProviders: (['oidc', 'google', 'github'] as const).filter((p) => socialProviders[p]),
        search: location.search,
        guards,
        cancelled: redirectCancelled,
        now: Date.now(),
      }),
    [loginMode, socialProviders, location.search, guards, redirectCancelled],
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSocialError(null);
    setLoading(true);
    try {
      if (!username || !password) {
        setError(t('auth.emptyFields'));
        setLoading(false);
        return;
      }
      if (registering) {
        if (password !== confirmPassword) {
          setError(t('auth.passwordsNotMatch'));
          return;
        }
        if (await register(username, password)) redirectAfterLogin();
        return;
      }
      const result = await login(username, password);
      if (result.success) {
        if (result.isUsingDefaultPassword) setShowDefaultPasswordWarning(true);
        else redirectAfterLogin();
      } else {
        const message = result.message;
        setError(
          isServerUnavailableError(message) ? t('auth.serverUnavailable') : t('auth.loginFailed'),
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : undefined;
      setError(
        isServerUnavailableError(message) ? t('auth.serverUnavailable') : t('auth.loginError'),
      );
    } finally {
      setLoading(false);
    }
  };

  const handleSocialLogin = async (provider: SocialProvider, automatic = false) => {
    setSocialError(null);
    setSocialLoading(provider);
    if (!automatic) clearLoggedOut();
    try {
      if (provider === 'oidc') {
        await startOidcLogin({
          providerId: oidcProviderId,
          callbackURL: returnUrl || '/',
          errorCallbackURL: `${getBasePath()}/login`,
          basePathOverride: betterAuthBasePath,
        });
        return;
      }

      const client = createBetterAuthClient(betterAuthBasePath);
      await client.signIn.social({
        provider,
        callbackURL: returnUrl || '/',
        errorCallbackURL: `${getBasePath()}/login`,
      });
    } catch (err) {
      console.error('Social login error:', err);
      setSocialError(t('auth.socialLoginFailed'));
      setSocialLoading(null);
      // A failed automatic start falls back to the buttons instead of retrying
      if (automatic) setRedirectCancelled(true);
    }
  };

  // sso_redirect: leave for the provider once, only after the session check found nobody signed in
  useEffect(() => {
    if (!configLoaded || auth.loading || auth.isAuthenticated) return;
    if (presentation.view !== 'redirecting' || !presentation.autoRedirectTo) return;
    if (autoRedirectStarted.current) return;
    const provider = presentation.autoRedirectTo;
    // A short pause keeps "Use another sign-in method" reachable; cancelling changes the
    // presentation, and the cleanup then clears the timer before anything is recorded
    const timer = window.setTimeout(() => {
      autoRedirectStarted.current = true;
      // No cooldown record, no redirect: the record is what stops a loop
      if (!recordAutoRedirect(Date.now())) {
        setGuards((current) => ({ ...current, storageAvailable: false }));
        return;
      }
      void handleSocialLogin(provider, true);
    }, AUTO_REDIRECT_DELAY_MS);
    return () => window.clearTimeout(timer);
    // handleSocialLogin is recreated every render and left out on purpose; the ref makes this fire once
  }, [configLoaded, auth.loading, auth.isAuthenticated, presentation]);

  const handlePasskeyLogin = async () => {
    setError(null);
    setSocialError(null);
    setSocialLoading('passkey');
    try {
      const result = await loginWithPasskey();
      if (result.success) {
        redirectAfterLogin();
        return;
      }
      if (result.error === 'cancelled') setSocialError(t('auth.passkeyCancelled'));
      else if (result.error === 'insecureContext') setSocialError(t('passkeys.insecureContext'));
      else if (result.error || result.code === 'passkey_login_failed' || !result.message) {
        setSocialError(t('auth.passkeyLoginFailed'));
      } else if (isServerUnavailableError(result.message)) {
        setSocialError(t('auth.serverUnavailable'));
      } else {
        // For example a rate limit, or SSO-only sign-in switched on after the page loaded
        setSocialError(result.message);
      }
    } catch {
      setSocialError(t('auth.passkeyLoginFailed'));
    } finally {
      setSocialLoading(null);
    }
  };

  const formError = error || (registering ? auth.error : null);
  // Passkeys belong to local accounts, so they follow the password sign-in policy.
  const showPasskey = passkeySupport && !passwordLoginDisabled && !registering;

  const handleCloseWarning = () => {
    setShowDefaultPasswordWarning(false);
    redirectAfterLogin();
  };

  return (
    <div
      className="relative min-h-screen w-full overflow-hidden"
      style={{ background: 'var(--hub-bg)', color: 'var(--hub-ink)' }}
    >
      {/* Top-right controls */}
      <div className="absolute top-3 right-4 z-20 flex items-center gap-1">
        <a
          href={PROJECT_REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="hub-icon-btn"
          aria-label="GitHub Repository"
        >
          <GitHubIcon className="h-4 w-4" />
        </a>
        <a
          href={PROJECT_DOCS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="hub-icon-btn"
          aria-label="Documentation"
        >
          <BookOpen className="h-4 w-4" />
        </a>
        <ThemeSwitch />
        <LanguageSwitch />
      </div>

      {/* Subtle grid pattern (kept low-key, hair-line) */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <svg className="h-full w-full" style={{ opacity: 0.5 }} xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">
              <path
                d="M 32 0 L 0 0 0 32"
                fill="none"
                stroke="var(--hub-line-2)"
                strokeWidth="0.5"
              />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>
      </div>

      <div className="relative mx-auto flex min-h-screen w-full max-w-md items-center justify-center px-6">
        <div className="w-full space-y-8">
          {/* Brand */}
          <div className="flex flex-col items-center gap-3">
            {brandLogo ? (
              <img
                src={brandLogo}
                alt={dashboardTitle}
                data-brand-logo
                className="block max-w-full object-contain"
                style={{ maxHeight: 56 }}
                draggable={false}
              />
            ) : (
              <BrandMark variant="ink" />
            )}
            <div className="text-center">
              <h1
                className={brandLogo ? 'sr-only' : undefined}
                style={{
                  fontSize: 20,
                  fontWeight: 600,
                  letterSpacing: '-0.02em',
                  color: 'var(--hub-ink)',
                }}
              >
                {dashboardTitle}
              </h1>
              <p className="hub-sub" style={{ marginTop: 4 }}>
                {t('auth.slogan')}
              </p>
            </div>
          </div>

          {/* Login card */}
          <div
            className="hub-card"
            style={{
              padding: '22px 22px 20px',
              boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
            }}
          >
            <LoginMethods
              view={presentation.view}
              blockedBy={presentation.blockedBy}
              passwordAllowed={!passwordLoginDisabled}
              passwordExpanded={passwordExpanded || presentation.forceLocal || registering}
              passwordForm={
                <form className="space-y-3" onSubmit={handleSubmit}>
                  <div>
                    <label
                      htmlFor="username"
                      className="hub-sect block"
                      style={{ marginBottom: 6 }}
                    >
                      {t('auth.username')}
                    </label>
                    <input
                      id="username"
                      name="username"
                      type="text"
                      autoComplete="username"
                      required
                      className="hub-input"
                      placeholder={t('auth.username')}
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="password"
                      className="hub-sect block"
                      style={{ marginBottom: 6 }}
                    >
                      {t('auth.password')}
                    </label>
                    <input
                      id="password"
                      name="password"
                      type="password"
                      autoComplete={registering ? 'new-password' : 'current-password'}
                      minLength={registering ? 8 : undefined}
                      required
                      className="hub-input"
                      placeholder={t('auth.password')}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </div>

                  {registering && (
                    <div>
                      <p className="hub-sub mb-3">{t('auth.passwordStrengthHint')}</p>
                      <label htmlFor="confirmPassword" className="hub-sect block mb-1.5">
                        {t('auth.confirmPassword')}
                      </label>
                      <input
                        id="confirmPassword"
                        name="confirmPassword"
                        type="password"
                        autoComplete="new-password"
                        required
                        className="hub-input"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                      />
                    </div>
                  )}

                  {formError && (
                    <div
                      role="alert"
                      className="flex items-center gap-2"
                      style={{
                        padding: '8px 10px',
                        borderRadius: 7,
                        border: '1px solid oklch(0.85 0.1 25)',
                        background: 'oklch(0.97 0.03 25)',
                        color: 'oklch(0.4 0.18 25)',
                        fontSize: 12.5,
                      }}
                    >
                      <AlertCircle size={13} className="flex-shrink-0" />
                      <span>{formError}</span>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={loading}
                    className="hub-btn primary w-full justify-center"
                    style={{ height: 34 }}
                  >
                    {loading
                      ? t('common.loading')
                      : t(registering ? 'auth.createAccount' : 'auth.login')}
                  </button>
                  {allowRegistration && (
                    <button
                      type="button"
                      disabled={loading}
                      className="hub-btn w-full justify-center"
                      onClick={() => {
                        setRegistering(!registering);
                        setError(null);
                        setPassword('');
                        setConfirmPassword('');
                      }}
                    >
                      {t(registering ? 'auth.backToLogin' : 'auth.createAccount')}
                    </button>
                  )}
                </form>
              }
              showPasskey={showPasskey}
              providers={socialProviders}
              oidcDisplayName={oidcDisplayName}
              redirectProvider={presentation.autoRedirectTo}
              redirectInFlight={socialLoading !== null}
              socialLoading={socialLoading}
              loading={loading}
              socialError={socialError}
              onSocialLogin={(provider) => void handleSocialLogin(provider)}
              onPasskeyLogin={() => void handlePasskeyLogin()}
              onExpandPassword={() => setPasswordExpanded(true)}
              onCancelRedirect={() => setRedirectCancelled(true)}
            />
          </div>

          <p className="text-center hub-mono" style={{ fontSize: 11, color: 'var(--hub-ink-3)' }}>
            v{APP_VERSION}
          </p>
        </div>
      </div>

      <DefaultPasswordWarningModal
        isOpen={showDefaultPasswordWarning}
        onClose={handleCloseWarning}
      />
    </div>
  );
};

export default LoginPage;
