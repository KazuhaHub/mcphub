import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import ChangePasswordForm from '@/components/ChangePasswordForm';
import PasskeysPage from '@/pages/PasskeysPage';
import OAuthApprovalsPage from '@/pages/OAuthApprovalsPage';
import { useAuth } from '@/contexts/AuthContext';
import { useSettings } from '@/contexts/SettingsContext';
import { homePath } from '@/utils/navigationPermissions';

const TABS = ['password', 'passkeys', 'apps'] as const;
export type AccountTab = (typeof TABS)[number];

const isTab = (value: string | null): value is AccountTab =>
  TABS.some((entry) => entry === value);

// Everything that belongs to the signed-in person's own sign-in, in one place.
const AccountSettingsPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { auth } = useAuth();
  const { workspaceEnabled } = useSettings();
  const [search, setSearch] = useSearchParams();
  const requested = search.get('tab');
  const tab: AccountTab = isTab(requested) ? requested : 'password';
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(leaveTimer.current), []);

  const selectTab = (value: AccountTab) =>
    setSearch(
      (params) => {
        params.set('tab', value);
        return params;
      },
      { replace: true },
    );

  // Arrow keys move between tabs; only the selected one is in the tab order.
  const onTabKeyDown = (event: React.KeyboardEvent) => {
    const index = TABS.indexOf(tab);
    const next =
      event.key === 'ArrowRight'
        ? TABS[(index + 1) % TABS.length]
        : event.key === 'ArrowLeft'
          ? TABS[(index + TABS.length - 1) % TABS.length]
          : event.key === 'Home'
            ? TABS[0]
            : event.key === 'End'
              ? TABS[TABS.length - 1]
              : null;
    if (!next) return;
    event.preventDefault();
    selectTab(next);
    document.getElementById(`account-tab-${next}`)?.focus();
  };

  // Leave a moment after a successful change so the confirmation can be read.
  const handlePasswordChangeSuccess = () => {
    leaveTimer.current = setTimeout(() => {
      navigate(homePath({ isAdmin: Boolean(auth.user?.isAdmin), workspaceEnabled }));
    }, 2000);
  };

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <h1 className="hub-h1">{t('account.title')}</h1>

      <div
        className="hub-tabs"
        role="tablist"
        aria-label={t('account.tabsLabel')}
        onKeyDown={onTabKeyDown}
        data-testid="account-tabs"
      >
        {TABS.map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            id={`account-tab-${value}`}
            aria-controls="account-tabpanel"
            aria-selected={tab === value}
            tabIndex={tab === value ? 0 : -1}
            className="hub-tab"
            onClick={() => selectTab(value)}
          >
            {t(`account.tabs.${value}`)}
          </button>
        ))}
      </div>

      <div
        key={tab}
        id="account-tabpanel"
        className="hub-reveal"
        role="tabpanel"
        aria-labelledby={`account-tab-${tab}`}
      >
        {tab === 'password' && (
          <ChangePasswordForm showTitle={false} onSuccess={handlePasswordChangeSuccess} />
        )}
        {tab === 'passkeys' && <PasskeysPage embedded />}
        {tab === 'apps' && <OAuthApprovalsPage embedded />}
      </div>
    </div>
  );
};

export default AccountSettingsPage;
