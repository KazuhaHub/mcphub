import React from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, KeyRound, Loader2 } from 'lucide-react';
import GitHubIcon from '@/components/icons/GitHubIcon';
import type { AutoRedirectBlock, LoginView, SsoProvider } from '@/utils/loginPresentation';

export type AlternativeSignIn = SsoProvider | 'passkey';

export interface LoginMethodsProps {
  view: LoginView;
  blockedBy: AutoRedirectBlock | null;
  /** Password sign-in is accepted (the effective `disablePasswordLogin` is off). */
  passwordAllowed: boolean;
  /** sso_first only: the password section is open. */
  passwordExpanded: boolean;
  /** The username/password form, rendered by the page that owns its state. */
  passwordForm: React.ReactNode;
  showPasskey: boolean;
  providers: Record<SsoProvider, boolean>;
  oidcDisplayName?: string;
  redirectProvider: SsoProvider | null;
  socialLoading: AlternativeSignIn | null;
  loading: boolean;
  socialError: string | null;
  onSocialLogin: (provider: SsoProvider) => void;
  onPasskeyLogin: () => void;
  onExpandPassword: () => void;
  onCancelRedirect: () => void;
}

const ErrorNote: React.FC<{ message: string }> = ({ message }) => (
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
    <span>{message}</span>
  </div>
);

const Divider: React.FC<{ label: string }> = ({ label }) => (
  <div className="flex items-center gap-3">
    <div className="h-px flex-1" style={{ background: 'var(--hub-line)' }} />
    <span className="hub-sect" style={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}>
      {label}
    </span>
    <div className="h-px flex-1" style={{ background: 'var(--hub-line)' }} />
  </div>
);

const BLOCK_NOTES: Partial<Record<AutoRedirectBlock, string>> = {
  loggedOut: 'auth.ssoRedirectPausedLoggedOut',
  recentAttempt: 'auth.ssoRedirectPausedLoop',
};

/**
 * The sign-in methods inside the login card, laid out for the effective login mode. `dual` is the
 * original layout: password form, then passkey and SSO buttons below an "or" divider.
 */
const LoginMethods: React.FC<LoginMethodsProps> = ({
  view,
  blockedBy,
  passwordAllowed,
  passwordExpanded,
  passwordForm,
  showPasskey,
  providers,
  oidcDisplayName,
  redirectProvider,
  socialLoading,
  loading,
  socialError,
  onSocialLogin,
  onPasskeyLogin,
  onExpandPassword,
  onCancelRedirect,
}) => {
  const { t } = useTranslation();
  const providerName = (provider: SsoProvider): string =>
    provider === 'google'
      ? 'Google'
      : provider === 'github'
        ? 'GitHub'
        : oidcDisplayName || t('auth.ssoProviderFallback');
  const oidcLabel = oidcDisplayName
    ? t('auth.loginWithProvider', { name: oidcDisplayName })
    : t('auth.loginWithOIDC');

  const passkeyButton = showPasskey && (
    <button
      type="button"
      onClick={onPasskeyLogin}
      disabled={socialLoading !== null || loading}
      className="hub-btn w-full justify-center"
      style={{ height: 34 }}
      data-testid="login-passkey"
    >
      <KeyRound className="h-3.5 w-3.5" />
      {socialLoading === 'passkey' ? t('auth.loggingIn') : t('auth.loginWithPasskey')}
    </button>
  );

  // `prominent`: the SSO-first layouts, where SSO is the main action
  const ssoButtons = (prominent: boolean) => (
    <>
      {providers.oidc && (
        <button
          type="button"
          onClick={() => onSocialLogin('oidc')}
          disabled={socialLoading !== null}
          className={`hub-btn w-full justify-center${prominent ? ' primary' : ''}`}
          style={{ height: prominent ? 38 : 34 }}
          data-testid="login-sso-oidc"
        >
          {socialLoading === 'oidc' ? t('auth.loggingIn') : oidcLabel}
        </button>
      )}
      {providers.google && (
        <button
          type="button"
          onClick={() => onSocialLogin('google')}
          disabled={socialLoading !== null}
          className={`hub-btn w-full justify-center${prominent ? ' primary' : ''}`}
          style={{ height: prominent ? 38 : 34 }}
          data-testid="login-sso-google"
        >
          {socialLoading === 'google' ? t('auth.loggingIn') : t('auth.loginWithGoogle')}
        </button>
      )}
      {providers.github && (
        <button
          type="button"
          onClick={() => onSocialLogin('github')}
          disabled={socialLoading !== null}
          className="hub-btn w-full justify-center"
          style={{
            height: prominent ? 38 : 34,
            background: 'var(--hub-ink)',
            color: 'var(--hub-bg)',
            borderColor: 'var(--hub-ink)',
          }}
          data-testid="login-sso-github"
        >
          <GitHubIcon className="h-3.5 w-3.5" />
          {socialLoading === 'github' ? t('auth.loggingIn') : t('auth.loginWithGithub')}
        </button>
      )}
    </>
  );

  if (view === 'redirecting' && redirectProvider) {
    return (
      <div className="space-y-4 text-center" data-login-view="redirecting">
        <div
          className="flex items-center justify-center gap-2"
          role="status"
          aria-live="polite"
          style={{ fontSize: 13.5, color: 'var(--hub-ink-2)', minHeight: 38 }}
        >
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          <span>{t('auth.redirectingToSso', { name: providerName(redirectProvider) })}</span>
        </div>
        <button
          type="button"
          className="hub-btn ghost w-full justify-center"
          onClick={onCancelRedirect}
          data-testid="login-cancel-redirect"
        >
          {t('auth.useAnotherMethod')}
        </button>
      </div>
    );
  }

  if (view === 'sso_first' || view === 'redirecting') {
    const note = blockedBy ? BLOCK_NOTES[blockedBy] : undefined;
    const showPasswordSection = passwordAllowed && passwordExpanded;
    return (
      <div className="space-y-3" data-login-view="sso_first">
        {note && (
          <p className="hub-sub text-center" data-testid="login-redirect-note">
            {t(note)}
          </p>
        )}
        {socialError && <ErrorNote message={socialError} />}
        <div className="space-y-2">{ssoButtons(true)}</div>
        {passwordAllowed && !passwordExpanded && (
          <button
            type="button"
            className="hub-btn ghost w-full justify-center"
            onClick={onExpandPassword}
            aria-expanded={false}
            data-testid="login-show-password"
          >
            {t('auth.usePasswordInstead')}
          </button>
        )}
        {showPasswordSection && (
          <div className="space-y-3 pt-2" data-testid="login-password-section">
            <Divider label={t('auth.orUsePassword')} />
            {passwordForm}
            {passkeyButton}
          </div>
        )}
      </div>
    );
  }

  const showAlternatives = Boolean(
    passkeyButton || providers.google || providers.github || providers.oidc,
  );
  return (
    <div data-login-view="dual">
      {passwordAllowed && passwordForm}
      {showAlternatives && (
        <div className={passwordAllowed ? 'mt-5 space-y-3' : 'space-y-3'}>
          {passwordAllowed && <Divider label={t('auth.orContinue')} />}
          {socialError && <ErrorNote message={socialError} />}
          <div className="space-y-2">
            {passkeyButton}
            {ssoButtons(false)}
          </div>
        </div>
      )}
    </div>
  );
};

export default LoginMethods;
