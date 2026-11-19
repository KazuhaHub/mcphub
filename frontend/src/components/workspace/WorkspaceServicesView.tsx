import React, { useLayoutEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Plus, RefreshCw } from 'lucide-react';
import { countHiddenTools } from '@/utils/toolRisk';
import {
  countExposedTools,
  isAdded,
  toolCountLevel,
  workspaceServicePath,
  type ServiceTab,
} from '@/utils/workspace';
import { refreshWorkspace, useWorkspaceData } from '@/hooks/useWorkspaceData';
import { useServiceActions } from '@/hooks/useServiceActions';
import WorkspaceDataGate from './WorkspaceDataGate';
import AddServiceDialog from './AddServiceDialog';
import WorkspaceServiceRow, { type RowAction } from './WorkspaceServiceRow';

// The main area scrolls, not the window: remember where the list was when a service was opened,
// so coming back lands on the same row.
let savedListScroll: number | null = null;
const scroller = (): HTMLElement | null => document.querySelector('main');

const ServicesList: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // The page's single source of truth: servers, endpoints and the user's credential bindings.
  const { servers: allServers, bindings, loaded } = useWorkspaceData();
  const [adding, setAdding] = useState(false);
  // Only what the user added is listed; the rest is found through Add service.
  const servers = allServers.filter(isAdded);

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
          <div className="flex flex-wrap gap-2">
            <button type="button" className="hub-btn" onClick={() => void refreshWorkspace()}>
              <RefreshCw size={13} /> {t('common.refresh')}
            </button>
            <button
              type="button"
              className="hub-btn primary"
              data-testid="add-service"
              onClick={() => setAdding(true)}
            >
              <Plus size={13} /> {t('workspacePage.catalog.add')}
            </button>
          </div>
        </div>
        {servers.length === 0 ? (
          <div
            className="px-4 py-10 text-center text-sm"
            style={{ color: 'var(--hub-ink-3)', borderTop: '1px solid var(--hub-line-2)' }}
            data-testid="services-empty"
          >
            <p>
              {t(
                allServers.length === 0
                  ? 'workspacePage.services.empty'
                  : 'workspacePage.services.noneAdded',
              )}
            </p>
            {allServers.length > 0 && (
              <button
                type="button"
                className="hub-btn primary mt-3"
                onClick={() => setAdding(true)}
              >
                <Plus size={13} /> {t('workspacePage.catalog.add')}
              </button>
            )}
          </div>
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

      {adding && <AddServiceDialog onClose={() => setAdding(false)} />}
    </div>
  );
};

const WorkspaceServicesView: React.FC = () => (
  <WorkspaceDataGate>
    <ServicesList />
  </WorkspaceDataGate>
);

export default WorkspaceServicesView;
