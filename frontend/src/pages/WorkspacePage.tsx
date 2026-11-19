import React from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import ConnectCard from '@/components/connect/ConnectCard';
import ActivityPanel from '@/components/workspace/ActivityPanel';
import ConnectedClientsPanel from '@/components/workspace/ConnectedClientsPanel';
import WorkspaceServicesView from '@/components/workspace/WorkspaceServicesView';

type WorkspaceTab = 'services' | 'clients' | 'activity';

const TABS: readonly WorkspaceTab[] = ['services', 'clients', 'activity'];

// A query parameter rather than a nested route: the SPA is served with a relative asset base,
// so a deep link two segments down could not load its scripts after a reload.
const WorkspacePage: React.FC = () => {
  const { t } = useTranslation();
  const [search, setSearch] = useSearchParams();
  const requested = search.get('tab');
  const tab: WorkspaceTab =
    requested === 'clients' || requested === 'activity' ? requested : 'services';

  const select = (value: WorkspaceTab) => setSearch(value === 'services' ? {} : { tab: value });

  // Arrow keys move between tabs; only the selected tab is in the tab order, so focus and
  // selection never point at different tabs.
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
    select(next);
    document.getElementById(`workspace-tab-${next}`)?.focus();
  };

  const tabButton = (value: WorkspaceTab, label: string) => (
    <button
      type="button"
      role="tab"
      id={`workspace-tab-${value}`}
      aria-controls="workspace-tabpanel"
      aria-selected={tab === value}
      tabIndex={tab === value ? 0 : -1}
      className="hub-tab"
      onClick={() => select(value)}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="hub-h1">{t('workspacePage.title')}</h1>
        <p className="hub-sub">{t('workspacePage.subtitle')}</p>
      </div>

      <ConnectCard />

      <div
        className="hub-tabs"
        role="tablist"
        aria-label={t('workspacePage.title')}
        onKeyDown={onTabKeyDown}
      >
        {tabButton('services', t('workspacePage.services.tab'))}
        {tabButton('clients', t('workspacePage.clients.tab'))}
        {tabButton('activity', t('workspacePage.activity.tab'))}
      </div>

      <div
        key={tab}
        id="workspace-tabpanel"
        className="hub-reveal"
        role="tabpanel"
        aria-labelledby={`workspace-tab-${tab}`}
      >
        {tab === 'clients' ? (
          <ConnectedClientsPanel />
        ) : tab === 'activity' ? (
          <ActivityPanel />
        ) : (
          <WorkspaceServicesView />
        )}
      </div>
    </div>
  );
};

export default WorkspacePage;
