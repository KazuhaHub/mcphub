import React, { useLayoutEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Info, RefreshCw } from 'lucide-react';
import { countHiddenTools } from '@/utils/toolRisk';
import {
  countExposedTools,
  toolCountLevel,
  workspaceServicePath,
  type ServiceTab,
} from '@/utils/workspace';
import { refreshWorkspace, useWorkspaceData } from '@/hooks/useWorkspaceData';
import { useServiceActions } from '@/hooks/useServiceActions';
import WorkspaceServiceRow, { type RowAction } from './WorkspaceServiceRow';

// The main area scrolls, not the window: remember where the list was when a service was opened,
// so coming back lands on the same row.
let savedListScroll: number | null = null;
const scroller = (): HTMLElement | null => document.querySelector('main');

const WorkspaceServicesView: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // The page's single source of truth: servers, endpoints and the user's credential bindings.
  const { servers, bindings, loaded, error } = useWorkspaceData();

  const open = (name: string, tab?: ServiceTab, state?: { authorizationUrl: string }) => {
    savedListScroll = scroller()?.scrollTop ?? null;
    navigate(workspaceServicePath(name, tab), { state });
  };
  const { pending, toggle, signIn } = useServiceActions({
    // The link is shown on the service's page, which is where the user lands.
    onAuthorizationLink: (name, url) => open(name, undefined, { authorizationUrl: url }),
  });

  useLayoutEffect(() => {
    if (!loaded || savedListScroll === null) return;
    scroller()?.scrollTo?.(0, savedListScroll);
    savedListScroll = null;
  }, [loaded]);

  const onAction = (name: string, action: RowAction) => {
    if (action === 'signin') void signIn(name);
    else open(name, 'credentials');
  };

  if (!loaded && !error) {
    return (
      <div className="space-y-4" role="status" aria-busy="true">
        <span className="sr-only">{t('workspacePage.loading')}</span>
        <span className="hub-skeleton h-11 w-full" aria-hidden />
        <div className="hub-card divide-y divide-[var(--hub-line-2)]" aria-hidden>
          {[0, 1, 2].map((row) => (
            <div key={row} className="flex items-center gap-4 px-4 py-4">
              <span className="hub-skeleton h-[18px] w-[30px] rounded-full" />
              <div className="flex-1 space-y-2">
                <span className="hub-skeleton h-3.5 w-40" />
                <span className="hub-skeleton h-3 w-64 max-w-full" />
              </div>
              <span className="hub-skeleton h-8 w-20" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error && !loaded) {
    return (
      <div className="hub-callout err items-center justify-between" role="alert">
        <div>
          <div className="font-medium">
            {t(error.disabled ? 'workspacePage.disabled' : 'workspacePage.loadFailed')}
          </div>
          {error.detail && !error.disabled && (
            <div className="text-[12px]" style={{ color: 'var(--hub-ink-3)' }}>
              {error.detail}
            </div>
          )}
        </div>
        <button
          type="button"
          className="hub-btn"
          onClick={() => (error.disabled ? window.location.reload() : void refreshWorkspace())}
        >
          <RefreshCw size={13} />{' '}
          {t(error.disabled ? 'workspacePage.reload' : 'workspacePage.retry')}
        </button>
      </div>
    );
  }

  const credentialServers = bindings ? new Set(bindings.map((entry) => entry.serverName)) : null;
  const hiddenTools = countHiddenTools(servers);
  const exposedTools = countExposedTools(servers);
  const toolLevel = toolCountLevel(exposedTools);

  return (
    <div className="space-y-4">
      <section className="hub-card overflow-hidden" aria-labelledby="workspace-services-title">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div>
            <h2 id="workspace-services-title" className="hub-card-title">
              {t('workspacePage.services.title')}
            </h2>
            <p className="hub-sub">{t('workspacePage.services.description')}</p>
            {(hiddenTools > 0 || toolLevel !== 'ok') && (
              <p
                className="mt-1 text-[12px]"
                style={{ color: 'var(--hub-ink-3)' }}
                role="status"
                data-testid="workspace-notes"
              >
                {hiddenTools > 0 && (
                  <span data-testid="hidden-tools-note">
                    {t('workspacePage.risk.hiddenSummary', { count: hiddenTools })}
                  </span>
                )}
                {hiddenTools > 0 && toolLevel !== 'ok' && ' '}
                {toolLevel !== 'ok' && (
                  <span data-testid="tools-hint" data-level={toolLevel}>
                    {t(
                      toolLevel === 'strong'
                        ? 'workspacePage.toolsHint.strong'
                        : 'workspacePage.toolsHint.warn',
                      { count: exposedTools },
                    )}
                  </span>
                )}
              </p>
            )}
          </div>
          <button type="button" className="hub-btn" onClick={() => void refreshWorkspace()}>
            <RefreshCw size={13} /> {t('common.refresh')}
          </button>
        </div>
        {servers.length === 0 ? (
          <p
            className="px-4 py-10 text-center text-sm"
            style={{ color: 'var(--hub-ink-3)', borderTop: '1px solid var(--hub-line-2)' }}
          >
            {t('workspacePage.services.empty')}
          </p>
        ) : (
          <ul>
            {servers.map((server) => (
              <WorkspaceServiceRow
                key={server.name}
                server={server}
                credentialServers={credentialServers}
                credentialBinding={bindings?.find((entry) => entry.serverName === server.name)}
                busy={pending.has(server.name)}
                onToggle={(name, selected) => void toggle(name, selected)}
                onOpen={(name) => open(name)}
                onAction={onAction}
              />
            ))}
          </ul>
        )}
      </section>

    </div>
  );
};

export default WorkspaceServicesView;
