import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Info, RefreshCw } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import {
  fetchCredentialBindings,
  fetchWorkspaceEndpoints,
  fetchWorkspaceServers,
  saveRiskCeiling,
  saveServerSelection,
  launchPersonalOAuth,
} from '@/services/workspaceService';
import type {
  MyCredentialBinding,
  ToolRiskLevel,
  WorkspaceEndpoints,
  WorkspaceServer,
} from '@/types';
import { changeRiskCeiling, countHiddenTools } from '@/utils/toolRisk';
import { copyText } from '@/utils/clipboard';
import {
  WorkspaceApiError,
  countExposedTools,
  createLatestOnly,
  pruneAuthLinks,
  shouldRefreshOnFocus,
  toolCountLevel,
  toggleServerSelection,
} from '@/utils/workspace';
import ConnectDialog from '@/components/connect/ConnectDialog';
import { notifyWorkspaceChanged, onWorkspaceChanged } from '@/utils/workspaceEvents';
import ServicePanel from './ServicePanel';
import WorkspaceServiceRow, { type RowAction } from './WorkspaceServiceRow';

const WorkspaceServicesView: React.FC = () => {
  const { t } = useTranslation();
  const [search, setSearch] = useSearchParams();
  const { showToast } = useToast();

  const [servers, setServers] = useState<WorkspaceServer[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [endpoints, setEndpoints] = useState<WorkspaceEndpoints | null>(null);
  // Bindings of the services that take personal credentials; null while unknown or failed.
  const [bindings, setBindings] = useState<MyCredentialBinding[] | null>(null);
  const [bindingsError, setBindingsError] = useState('');
  // Service whose panel is open. `/workspace?service=` opens it; the older
  // `?credentials=` (an old `/credentials?server=` link lands there) also moves to its
  // credentials section.
  const [panel, setPanel] = useState<{ name: string; credentials: boolean } | null>(() => {
    const credentials = search.get('credentials');
    if (credentials) return { name: credentials, credentials: true };
    const service = search.get('service');
    return service ? { name: service, credentials: false } : null;
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ detail: string; disabled: boolean } | null>(null);
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [connectService, setConnectService] = useState<string | null>(null);
  const [authLinks, setAuthLinks] = useState<Record<string, string>>({});
  // Selection saves in flight, readable from event handlers without a re-render.
  const pendingRef = useRef(0);
  // Only the newest refresh may write state; a slow stale one must not undo a newer view.
  const latest = useRef(createLatestOnly());
  // Marks this list's own announcements, so it does not reload twice for its own change.
  const origin = useRef(Symbol('workspace-list'));

  const refreshAll = useCallback(
    () =>
      latest.current
        .run(
          () => Promise.all([fetchWorkspaceServers(), fetchWorkspaceEndpoints()]),
          ([serverList, nextEndpoints]) => {
            setServers(serverList);
            // A blocked-popup link is moot once the server no longer asks for sign-in.
            setAuthLinks((links) => pruneAuthLinks(links, serverList));
            setLoaded(true);
            setEndpoints(nextEndpoints);
            setError(null);
          },
        )
        .then(() => undefined),
    [],
  );

  const load = useCallback(async () => {
    try {
      await refreshAll();
    } catch (err) {
      setError({
        detail: err instanceof Error ? err.message : '',
        disabled: err instanceof WorkspaceApiError && err.disabled,
      });
    } finally {
      setLoading(false);
    }
  }, [refreshAll]);

  // Read through a ref so a new translate function never restarts the loads.
  const tRef = useRef(t);
  tRef.current = t;

  // Servers with credential slots decide what "Connect" opens; failure falls back safely.
  const loadBindings = useCallback(
    () =>
      fetchCredentialBindings().then(
        (list) => {
          setBindings(list);
          setBindingsError('');
        },
        (err: unknown) => {
          setBindingsError(err instanceof Error ? err.message : tRef.current('credentials.failed'));
        },
      ),
    [],
  );

  useEffect(() => {
    void load();
    void loadBindings();
  }, [load, loadBindings]);

  // The link parameters have done their job once the panel is open.
  useEffect(() => {
    if (!search.has('credentials') && !search.has('service')) return;
    setSearch(
      (params) => {
        params.delete('credentials');
        params.delete('service');
        return params;
      },
      { replace: true },
    );
  }, [search, setSearch]);

  // A link to a service the user cannot see opens nothing.
  useEffect(() => {
    if (!loading && panel && !servers.some((server) => server.name === panel.name)) setPanel(null);
  }, [loading, panel, servers]);

  const closePanel = useCallback(() => setPanel(null), []);
  // Every credential change, wherever it was made (this panel, the Connect dialog opened here
  // or from the top card), refreshes the list and the bindings it shows.
  const refreshAfterChange = useCallback(async () => {
    await Promise.all([loadBindings(), refreshAll().catch(() => undefined)]);
  }, [loadBindings, refreshAll]);
  useEffect(
    () =>
      onWorkspaceChanged((from) => {
        if (from !== origin.current) void refreshAfterChange();
      }),
    [refreshAfterChange],
  );

  // Coming back from an OAuth tab or the provider's site: pick up the new status.
  useEffect(() => {
    const onFocus = () => {
      if (shouldRefreshOnFocus(pendingRef.current)) void refreshAfterChange();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refreshAfterChange]);

  const withPending = async (name: string, run: () => Promise<void>) => {
    setPending((current) => new Set(current).add(name));
    pendingRef.current++;
    // A refresh started earlier would carry the pre-change state back over the change.
    latest.current.invalidate();
    try {
      await run();
    } finally {
      pendingRef.current--;
      setPending((current) => {
        const next = new Set(current);
        next.delete(name);
        return next;
      });
    }
  };

  const onToggle = (name: string, selected: boolean) =>
    withPending(name, async () => {
      const saved = await toggleServerSelection(name, selected, {
        save: saveServerSelection,
        update: (updater) => setServers(updater),
      });
      if (!saved) {
        showToast(t('workspacePage.toggleFailed', { name }), 'error');
        return;
      }
      await refreshAll().catch(() => undefined);
      notifyWorkspaceChanged(origin.current);
    });

  const onRiskChange = (name: string, riskCeiling: ToolRiskLevel) =>
    withPending(name, async () => {
      const server = servers.find((candidate) => candidate.name === name);
      if (!server) return;
      const saved = await changeRiskCeiling(server, riskCeiling, {
        save: saveRiskCeiling,
        update: (updater) => setServers(updater),
      });
      if (!saved) {
        showToast(t('workspacePage.risk.changeFailed', { name }), 'error');
        return;
      }
      await refreshAll().catch(() => undefined);
      notifyWorkspaceChanged(origin.current);
    });

  const connectOAuth = (name: string) =>
    withPending(name, async () => {
      try {
        const result = await launchPersonalOAuth(name);
        if (result.kind === 'link') {
          setAuthLinks((links) => ({ ...links, [name]: result.url }));
          // The link is shown in the panel; open it if the click came from the row.
          setPanel((current) => current ?? { name, credentials: false });
          showToast(t('workspacePage.popupBlocked'), 'error');
        } else if (result.kind === 'invalid') {
          showToast(t('workspacePage.connectFailed'), 'error');
        }
        await refreshAll().catch(() => undefined);
        notifyWorkspaceChanged(origin.current);
      } catch (err) {
        showToast(
          t('workspacePage.connectFailed') +
            (err instanceof Error && err.message ? ` (${err.message})` : ''),
          'error',
        );
      }
    });

  const onAction = (name: string, action: RowAction) => {
    if (action === 'signin') void connectOAuth(name);
    else setPanel({ name, credentials: true });
  };

  const onCopyEndpoint = async (url: string) => {
    if (await copyText(url)) showToast(t('common.copySuccess'), 'success');
    else showToast(t('common.copyFailed'), 'error');
  };

  if (loading) {
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
          onClick={() => (error.disabled ? window.location.reload() : void load())}
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
  const endpointByName = new Map((endpoints?.servers ?? []).map((entry) => [entry.name, entry]));
  const panelServer = panel ? servers.find((server) => server.name === panel.name) : undefined;

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
          <button
            type="button"
            className="hub-btn"
            onClick={() => void refreshAll().catch(() => undefined)}
          >
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
                onToggle={(name, selected) => void onToggle(name, selected)}
                onOpen={(name, focus) => setPanel({ name, credentials: focus === 'credentials' })}
                onAction={onAction}
              />
            ))}
          </ul>
        )}
      </section>

      {panelServer && (
        <ServicePanel
          key={panelServer.name}
          server={panelServer}
          endpoint={endpointByName.get(panelServer.name)}
          credentialServers={credentialServers}
          credentialBinding={bindings?.find((entry) => entry.serverName === panelServer.name)}
          bindings={bindings}
          bindingsError={bindingsError}
          reloadCredentials={refreshAfterChange}
          busy={pending.has(panelServer.name)}
          authorizationUrl={authLinks[panelServer.name]}
          focusCredentials={panel?.credentials}
          onClose={closePanel}
          onRiskChange={(name, riskCeiling) => void onRiskChange(name, riskCeiling)}
          onAction={onAction}
          onCopyEndpoint={(url) => void onCopyEndpoint(url)}
          onConnectToAi={(name) => setConnectService(name)}
        />
      )}

      {connectService && endpoints && (
        <ConnectDialog
          aggregateUrl={endpoints.aggregate}
          servers={servers}
          endpoints={endpoints}
          initial={{ service: connectService }}
          onClose={() => setConnectService(null)}
        />
      )}
    </div>
  );
};

export default WorkspaceServicesView;
