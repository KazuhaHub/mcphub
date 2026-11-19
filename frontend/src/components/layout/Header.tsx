import { useBranding } from '@/contexts/BrandingContext';
import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useParams } from 'react-router-dom';
import { BookOpen, Loader2, Menu } from 'lucide-react';
import ThemeSwitch from '@/components/ui/ThemeSwitch';
import LanguageSwitch from '@/components/ui/LanguageSwitch';
import GitHubIcon from '@/components/icons/GitHubIcon';
import { useAuth } from '@/contexts/AuthContext';
import { useSettings } from '@/contexts/SettingsContext';
import { useEmbeddingSync } from '@/contexts/EmbeddingSyncContext';
import { PROJECT_DOCS_URL, PROJECT_REPO_URL } from '@/constants/links';

interface HeaderProps {
  onToggleSidebar: () => void;
  menuExpanded?: boolean;
}

const useCrumbs = (): string[] => {
  const { t } = useTranslation();
  const { dashboardTitle } = useBranding();
  const location = useLocation();
  const params = useParams();
  const { auth } = useAuth();
  const { workspaceEnabled } = useSettings();
  const adminCredentials = workspaceEnabled && Boolean(auth.user?.isAdmin);

  return useMemo(() => {
    const path = location.pathname;
    const root = dashboardTitle;
    if (path === '/') return [root, t('nav.dashboard')];
    if (path.startsWith('/services/')) {
      const raw = path.slice('/services/'.length).split('/')[0];
      try {
        return [root, decodeURIComponent(raw)];
      } catch {
        return [root, raw];
      }
    }
    if (path.startsWith('/workspace/services/')) {
      const raw = path.slice('/workspace/services/'.length).split('/')[0];
      let name = raw;
      try {
        name = decodeURIComponent(raw);
      } catch {
        // keep the raw segment
      }
      return [root, t('workspacePage.nav'), name];
    }
    if (path.startsWith('/workspace')) {
      const clientsTab = new URLSearchParams(location.search).get('tab') === 'clients';
      return clientsTab
        ? [root, t('workspacePage.nav'), t('workspacePage.clients.tab')]
        : [root, t('workspacePage.nav')];
    }
    if (path.startsWith('/oauth-applications')) return [root, t('oauthApprovals.title')];
    if (path.startsWith('/passkeys')) return [root, t('passkeys.title')];
    if (path.startsWith('/credentials'))
      return [root, t(adminCredentials ? 'credentials.adminTitle' : 'credentials.title')];
    if (path.startsWith('/servers')) return [root, t('nav.servers')];
    if (path.startsWith('/groups')) return [root, t('nav.groups')];
    if (path.startsWith('/prompts')) return [root, t('nav.prompts')];
    if (path.startsWith('/resources')) return [root, t('nav.resources')];
    if (path.startsWith('/users')) return [root, t('nav.users')];
    if (path.startsWith('/market')) {
      const serverName = (params as { serverName?: string }).serverName;
      const crumbs = [root, t('nav.market')];
      if (serverName) crumbs.push(serverName);
      return crumbs;
    }
    if (path.startsWith('/logs')) return [root, t('nav.logs')];
    if (path.startsWith('/activity')) return [root, t('nav.activity')];
    if (path.startsWith('/settings')) return [root, t('nav.settings')];
    return [root];
  }, [location.pathname, location.search, params, t, dashboardTitle, adminCredentials]);
};

const Header: React.FC<HeaderProps> = ({ onToggleSidebar, menuExpanded }) => {
  const { t } = useTranslation();
  const { activeSyncs } = useEmbeddingSync();
  const crumbs = useCrumbs();
  const activeSyncNames = activeSyncs.map((sync) => sync.serverName).join(', ');
  const activeSyncCurrent = activeSyncs.reduce((sum, sync) => sum + sync.current, 0);
  const activeSyncTotal = activeSyncs.reduce((sum, sync) => sum + sync.total, 0);
  const activeSyncPercent = activeSyncTotal
    ? Math.min(100, Math.round((activeSyncCurrent / activeSyncTotal) * 100))
    : 0;

  return (
    <header className="hub-topbar shrink-0">
      <button
        onClick={onToggleSidebar}
        className="hub-icon-btn"
        aria-label={t('app.toggleSidebar')}
        aria-controls="app-sidebar"
        aria-expanded={menuExpanded}
      >
        <Menu size={16} />
      </button>

      {/* Phones only have room for the current page; the full trail shows from md up. */}
      <div className="hub-crumb flex items-center min-w-0">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <React.Fragment key={i}>
              {i > 0 && <span className="sep max-md:hidden">/</span>}
              {last ? (
                <b className="truncate">{c}</b>
              ) : (
                <span className="truncate max-md:hidden">{c}</span>
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* Phones: a compact spinner with the combined percentage instead of the progress card. */}
      {activeSyncs.length > 0 && (
        <div
          role="status"
          data-testid="embedding-sync-compact"
          className="ml-auto flex shrink-0 items-center gap-1 text-[12px] hub-mono hub-num text-[var(--hub-ink-3)] md:hidden"
          aria-label={t('app.embeddingSyncProgressAriaLabel', {
            serverName: activeSyncNames,
            current: activeSyncCurrent,
            total: activeSyncTotal,
          })}
          title={t('app.embeddingSyncProgress', { serverName: activeSyncNames })}
        >
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          <span aria-hidden="true">{activeSyncPercent}%</span>
        </div>
      )}

      <div className="flex-1 flex justify-center px-2 min-w-0 max-md:hidden">
        {activeSyncs.length > 0 && (
          <div className="flex max-w-full flex-wrap justify-center gap-2">
            {activeSyncs.map((activeSync) => (
              <div
                key={activeSync.serverName}
                className="hub-card flex min-w-0 w-56 max-w-full flex-col px-3 py-1.5 text-xs"
                style={{ borderRadius: 7 }}
                title={t('app.embeddingSyncProgressAriaLabel', {
                  serverName: activeSync.serverName,
                  current: activeSync.current,
                  total: activeSync.total,
                })}
              >
                <span className="truncate hub-mono text-[var(--hub-ink-2)]">
                  {t('app.embeddingSyncProgress', { serverName: activeSync.serverName })}
                </span>
                <div className="mt-1 flex items-center gap-2">
                  <progress
                    className="h-1.5 flex-1"
                    value={activeSync.current}
                    max={activeSync.total}
                    aria-label={t('app.embeddingSyncProgressAriaLabel', {
                      serverName: activeSync.serverName,
                      current: activeSync.current,
                      total: activeSync.total,
                    })}
                  />
                  <span className="shrink-0 hub-mono hub-num text-[var(--hub-ink-3)]">
                    {activeSync.current}/{activeSync.total}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={`flex items-center gap-1 shrink-0 ${activeSyncs.length > 0 ? 'md:ml-auto' : 'ml-auto'}`}>
        <a
          href={PROJECT_REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="hub-icon-btn max-sm:hidden!"
          aria-label="GitHub Repository"
        >
          <GitHubIcon className="h-4 w-4" />
        </a>
        <a
          href={PROJECT_DOCS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="hub-icon-btn max-sm:hidden!"
          aria-label="Documentation"
        >
          <BookOpen className="h-4 w-4" />
        </a>
        <ThemeSwitch />
        <LanguageSwitch />
      </div>
    </header>
  );
};

export default Header;
