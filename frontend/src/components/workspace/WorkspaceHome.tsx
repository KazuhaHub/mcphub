import React from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, ChevronRight, Plus } from 'lucide-react';
import ServerIcon from '@/components/ServerIcon';
import { StatusDot } from '@/components/ui/StatusDot';
import { useServiceActions } from '@/hooks/useServiceActions';
import { useWorkspaceData } from '@/hooks/useWorkspaceData';
import {
  attentionItems,
  serviceChipTone,
  summarizeServices,
  workspaceServicePath,
} from '@/utils/workspace';
import WorkspaceDataGate from './WorkspaceDataGate';

const SERVICES_PATH = '/workspace/services';

const HomeBody: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { servers, bindings } = useWorkspaceData();
  const { pending, signIn } = useServiceActions({
    // The link is shown on the service's page, which is where the user lands.
    onAuthorizationLink: (name, url) =>
      navigate(workspaceServicePath(name), { state: { authorizationUrl: url } }),
  });

  const credentialServers = bindings ? new Set(bindings.map((entry) => entry.serverName)) : null;
  const attention = attentionItems(servers, credentialServers, bindings);
  const { on, added, available } = summarizeServices(servers);

  return (
    <div className="space-y-4">
      {attention.length > 0 && (
        <section
          className="hub-card overflow-hidden"
          aria-labelledby="home-attention-title"
          data-testid="home-attention"
        >
          <div className="px-4 py-4">
            <h2 id="home-attention-title" className="hub-card-title">
              {t('workspacePage.home.attention.title')}
            </h2>
            <p className="hub-sub">{t('workspacePage.home.attention.description')}</p>
          </div>
          <ul>
            {attention.map(({ server, chip, action, reauth }) => {
              const label =
                action === 'signin'
                  ? t(
                      reauth
                        ? 'workspacePage.chip.action.signinAgain'
                        : 'workspacePage.chip.action.signin',
                    )
                  : chip === 'credentials_outdated' || chip === 'credentials_rejected'
                    ? t('workspacePage.chip.action.update')
                    : t('workspacePage.chip.action.credentials');
              return (
                <li
                  key={server.name}
                  data-testid={`home-attention-${server.name}`}
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3"
                  style={{ borderTop: '1px solid var(--hub-line-2)' }}
                >
                  <ServerIcon name={server.name} icon={server.icon} size={24} />
                  <Link
                    to={workspaceServicePath(server.name)}
                    className="flex min-w-0 flex-1 basis-[120px] flex-wrap items-center gap-x-3 gap-y-1"
                    aria-label={t('workspacePage.home.openService', { name: server.name })}
                  >
                    <span className="min-w-0 break-words font-medium">{server.name}</span>
                    <span data-chip={chip}>
                      <StatusDot
                        kind={serviceChipTone(chip)}
                        label={t(`workspacePage.chip.${chip}`)}
                      />
                    </span>
                  </Link>
                  {action && (
                    <button
                      type="button"
                      className="hub-btn sm shrink-0"
                      data-testid={`home-action-${server.name}`}
                      data-action={action}
                      disabled={pending.has(server.name)}
                      aria-label={`${label}: ${server.name}`}
                      onClick={() =>
                        action === 'signin'
                          ? void signIn(server.name)
                          : navigate(workspaceServicePath(server.name, 'credentials'))
                      }
                    >
                      {label}
                    </button>
                  )}
                  <ChevronRight
                    size={16}
                    aria-hidden
                    className="shrink-0"
                    style={{ color: 'var(--hub-ink-3)' }}
                  />
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {on === 0 ? (
        <section
          className="hub-card flex flex-wrap items-center justify-between gap-3 px-4 py-4"
          data-testid="home-get-started"
        >
          <div className="min-w-0">
            <h2 className="hub-card-title">{t('workspacePage.home.getStarted.title')}</h2>
            <p className="hub-sub">
              {t(
                servers.length === 0
                  ? 'workspacePage.services.empty'
                  : 'workspacePage.home.getStarted.description',
              )}
            </p>
          </div>
          {servers.length > 0 && (
            <Link to={SERVICES_PATH} className="hub-btn primary">
              <Plus size={13} /> {t('workspacePage.home.getStarted.action')}
            </Link>
          )}
        </section>
      ) : (
        <div
          className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-1 text-[13px]"
          data-testid="home-counts"
        >
          <span style={{ color: 'var(--hub-ink-2)' }}>
            {t('workspacePage.home.counts', { on, added })}
            {available > 0 && ` · ${t('workspacePage.home.countsMore', { count: available })}`}
          </span>
          <Link
            to={SERVICES_PATH}
            className="inline-flex items-center gap-1 underline"
            style={{ color: 'var(--hub-accent)' }}
          >
            {t('workspacePage.home.manage')} <ArrowRight size={13} aria-hidden />
          </Link>
        </div>
      )}
    </div>
  );
};

const WorkspaceHome: React.FC = () => (
  <WorkspaceDataGate>
    <HomeBody />
  </WorkspaceDataGate>
);

export default WorkspaceHome;
