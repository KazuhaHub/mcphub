import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Copy, ExternalLink, Plug, Plus, RefreshCw, Trash2 } from 'lucide-react';
import ServerIcon from '@/components/ServerIcon';
import { StatusDot } from '@/components/ui/StatusDot';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import ConnectDialog from '@/components/connect/ConnectDialog';
import { CredentialPanelBody } from '@/components/credentials/CredentialDialog';
import { refreshWorkspace, useWorkspaceData, type WorkspaceData } from '@/hooks/useWorkspaceData';
import { useServiceActions } from '@/hooks/useServiceActions';
import type { WorkspaceServer } from '@/types';
import { getSafeManageHref } from '@/utils/manageUrl';
import { getServiceLinkHref } from '@/utils/serviceLink';
import { TOOL_RISK_LEVELS, countHiddenByCeiling, isRiskChoiceAllowed } from '@/utils/toolRisk';
import {
  hasCredentialSlots,
  isAdded,
  localizeStatusMessage,
  resolveServiceChip,
  resolveServiceNotice,
  serviceChipTone,
  type ServiceTab,
} from '@/utils/workspace';

const muted = { color: 'var(--hub-ink-3)' } as const;

const formatUntil = (value: string): string => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

const isTab = (value: string | null): value is ServiceTab =>
  value === 'overview' || value === 'credentials' || value === 'permissions';

/** The description, two lines until the reader asks for more. */
const Description: React.FC<{ text: string }> = ({ text }) => {
  const { t } = useTranslation();
  const ref = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && !expanded) setClamped(el.scrollHeight > el.clientHeight + 1);
  }, [text, expanded]);
  return (
    <div>
      <p
        ref={ref}
        data-testid="service-description"
        className={
          'whitespace-pre-line break-words text-[13px] leading-[1.6]' +
          (expanded ? '' : ' line-clamp-2')
        }
        style={{ color: 'var(--hub-ink-2)' }}
      >
        {text}
      </p>
      {(clamped || expanded) && (
        <button
          type="button"
          className="mt-0.5 text-[12px] underline"
          style={muted}
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {t(expanded ? 'workspacePage.service.less' : 'workspacePage.service.more')}
        </button>
      )}
    </div>
  );
};

const Page: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="mx-auto w-full max-w-3xl space-y-5">{children}</div>
);

const BackLink: React.FC = () => {
  const { t } = useTranslation();
  return (
    <Link
      to="/workspace/services"
      className="inline-flex items-center gap-1 text-[13px] underline"
      style={{ color: 'var(--hub-ink-2)' }}
    >
      <ArrowLeft size={13} aria-hidden /> {t('workspacePage.service.back')}
    </Link>
  );
};

const WorkspaceServicePage: React.FC = () => {
  const { t } = useTranslation();
  const { name = '' } = useParams<{ name: string }>();
  const data = useWorkspaceData();

  // A new page starts at its top; the main area is what scrolls.
  useEffect(() => {
    document.querySelector('main')?.scrollTo?.(0, 0);
  }, [name]);

  if (!data.loaded && !data.error) {
    return (
      <Page>
        <div role="status" aria-busy="true" className="space-y-3">
          <span className="sr-only">{t('workspacePage.loading')}</span>
          <span className="hub-skeleton h-4 w-24" aria-hidden />
          <span className="hub-skeleton h-8 w-64 max-w-full" aria-hidden />
          <span className="hub-skeleton h-24 w-full" aria-hidden />
        </div>
      </Page>
    );
  }
  if (data.error && !data.loaded) {
    return (
      <Page>
        <BackLink />
        <div className="hub-callout err items-center justify-between" role="alert">
          <div className="font-medium">
            {t(data.error.disabled ? 'workspacePage.disabled' : 'workspacePage.loadFailed')}
          </div>
          <button type="button" className="hub-btn" onClick={() => void refreshWorkspace()}>
            <RefreshCw size={13} /> {t('workspacePage.retry')}
          </button>
        </div>
      </Page>
    );
  }
  const server = data.servers.find((candidate) => candidate.name === name);
  if (!server) {
    return (
      <Page>
        <div className="hub-card p-8 text-center text-sm" role="status" data-testid="not-found">
          <p style={{ color: 'var(--hub-ink-2)' }}>{t('workspacePage.service.notFound')}</p>
          <div className="mt-3">
            <BackLink />
          </div>
        </div>
      </Page>
    );
  }
  return <ServiceDetail key={server.name} server={server} data={data} />;
};

const ServiceDetail: React.FC<{ server: WorkspaceServer; data: WorkspaceData }> = ({
  server,
  data,
}) => {
  const { t } = useTranslation();
  const location = useLocation();
  const [search, setSearch] = useSearchParams();
  const { endpoints, bindings, bindingsError } = data;
  const [authorizationUrl, setAuthorizationUrl] = useState<string | undefined>(
    (location.state as { authorizationUrl?: string } | null)?.authorizationUrl,
  );
  const [connecting, setConnecting] = useState(false);
  const [removing, setRemoving] = useState(false);
  const navigate = useNavigate();
  const { pending, toggle, setAdded, changeRisk, signIn, copyEndpoint } = useServiceActions({
    onAuthorizationLink: (_name, url) => setAuthorizationUrl(url),
  });
  const busy = pending.has(server.name);
  const added = isAdded(server);

  const endpoint = endpoints?.servers.find((entry) => entry.name === server.name);
  const binding = bindings?.find((entry) => entry.serverName === server.name);
  const credentialServers = bindings ? new Set(bindings.map((entry) => entry.serverName)) : null;
  const { chip } = resolveServiceChip(server, credentialServers, binding);
  const notice = resolveServiceNotice(server, credentialServers, binding);
  // A personal sign-in has no slots, so no credentials tab.
  const hasCredentials = hasCredentialSlots(server, credentialServers);

  // A blocked-popup link is moot once the server no longer asks for sign-in.
  const link = server.status.action === 'connect' ? authorizationUrl : undefined;

  const tabs: ServiceTab[] = [
    'overview',
    ...(hasCredentials ? (['credentials'] as const) : []),
    ...(added && server.selected ? (['permissions'] as const) : []),
  ];
  const requested = search.get('tab');
  const fallback: ServiceTab =
    notice?.action === 'credentials' && hasCredentials ? 'credentials' : 'overview';
  const tab: ServiceTab = isTab(requested) && tabs.includes(requested) ? requested : fallback;
  const selectTab = (value: ServiceTab) =>
    setSearch(
      (params) => {
        params.set('tab', value);
        return params;
      },
      { replace: true },
    );

  // Arrow keys move between tabs; only the selected one is in the tab order.
  const onTabKeyDown = (event: React.KeyboardEvent) => {
    const index = tabs.indexOf(tab);
    const next =
      event.key === 'ArrowRight'
        ? tabs[(index + 1) % tabs.length]
        : event.key === 'ArrowLeft'
          ? tabs[(index + tabs.length - 1) % tabs.length]
          : event.key === 'Home'
            ? tabs[0]
            : event.key === 'End'
              ? tabs[tabs.length - 1]
              : null;
    if (!next) return;
    event.preventDefault();
    selectTab(next);
    document.getElementById(`service-tab-${next}`)?.focus();
  };

  const { code } = server.status;
  const toolsPending =
    server.toolCount === null &&
    server.requiresPersonalCredential &&
    server.credentialConfigured &&
    server.enabled &&
    (code === 'available' || code === 'not_selected');
  const hidden = countHiddenByCeiling(server.riskCounts, server.riskCeiling);
  const manageHref = getSafeManageHref(server.manageUrl);
  const serverMessage = notice?.detail ? localizeStatusMessage(server.status, formatUntil) : '';
  const tone = notice ? serviceChipTone(notice.chip) : 'muted';

  const tabButton = (value: ServiceTab) => (
    <button
      key={value}
      type="button"
      role="tab"
      id={`service-tab-${value}`}
      aria-controls="service-tabpanel"
      aria-selected={tab === value}
      tabIndex={tab === value ? 0 : -1}
      className="hub-tab"
      onClick={() => selectTab(value)}
    >
      {t(`workspacePage.service.tab.${value}`)}
    </button>
  );

  return (
    <Page>
      <BackLink />

      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <ServerIcon name={server.name} icon={server.icon} size={40} />
          <h1 className="hub-h1 min-w-0 break-words" data-testid="service-title">
            {server.name}
          </h1>
          <span data-testid="service-chip" data-chip={chip}>
            <StatusDot kind={serviceChipTone(chip)} label={t(`workspacePage.chip.${chip}`)} />
          </span>
          {added ? (
            <button
              type="button"
              role="switch"
              aria-checked={server.selected}
              aria-label={t('workspacePage.services.toggleFor', { name: server.name })}
              data-testid="service-toggle"
              className={'hub-switch ml-auto' + (server.selected ? ' on' : '')}
              disabled={busy}
              onClick={() => void toggle(server.name, !server.selected)}
            />
          ) : (
            <button
              type="button"
              className="hub-btn primary ml-auto"
              data-testid="service-add"
              disabled={busy}
              onClick={() => void setAdded(server.name, true)}
            >
              <Plus size={13} /> {t('workspacePage.catalog.addToMine')}
            </button>
          )}
        </div>
        {server.description && <Description text={server.description} />}
      </header>

      {notice && (
        <div
          className={
            'hub-callout flex-wrap items-center justify-between gap-3 ' +
            (tone === 'err' ? 'err' : 'warn')
          }
          data-testid="service-notice"
          data-notice={notice.chip}
          role="status"
        >
          <div className="min-w-0 text-[13px]">
            <p>{t(`workspacePage.panel.statusText.${notice.text}`)}</p>
            {serverMessage && (
              <p className="mt-0.5 break-words text-[12px]" style={muted}>
                {serverMessage}
              </p>
            )}
            {link && (
              <a
                href={link}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 block text-[12px] underline"
              >
                {t('workspacePage.actions.openAuthorization')}
              </a>
            )}
          </div>
          {notice.action &&
            notice.label &&
            !(notice.action === 'credentials' && tab === 'credentials') && (
              <button
                type="button"
                className="hub-btn primary shrink-0"
                disabled={busy}
                data-testid="service-notice-action"
                data-action={notice.action}
                onClick={() => {
                  if (notice.action === 'signin') void signIn(server.name);
                  else selectTab('credentials');
                }}
              >
                {t(`workspacePage.service.action.${notice.label}`)}
              </button>
            )}
        </div>
      )}

      <div
        className="hub-tabs"
        role="tablist"
        aria-label={t('workspacePage.service.tabsLabel', { name: server.name })}
        onKeyDown={onTabKeyDown}
        data-testid="service-tabs"
      >
        {tabs.map(tabButton)}
      </div>

      <div
        key={tab}
        id="service-tabpanel"
        className="hub-reveal space-y-4"
        role="tabpanel"
        aria-labelledby={`service-tab-${tab}`}
      >
        {tab === 'overview' && (
          <>
            <p className="text-[13px]" data-testid="service-tools">
              {server.toolCount !== null
                ? t('workspacePage.services.toolCount', { count: server.toolCount })
                : toolsPending
                  ? t('workspacePage.risk.connectedPending')
                  : t('workspacePage.panel.toolsAfterSignIn')}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="hub-btn primary"
                disabled={!endpoint?.url}
                onClick={() => setConnecting(true)}
                title={
                  endpoint?.url
                    ? undefined
                    : t(endpoint?.conflict ? 'connect.serviceConflict' : 'connect.serviceNotReady')
                }
                aria-label={t('connect.rowActionFor', { name: server.name })}
              >
                <Plug size={13} /> {t('connect.rowAction')}
              </button>
              <button
                type="button"
                className="hub-btn"
                disabled={!endpoint?.url}
                onClick={() => endpoint?.url && void copyEndpoint(endpoint.url)}
                title={endpoint?.url ? undefined : t('workspacePage.services.endpointConflict')}
                aria-label={t('workspacePage.services.copyEndpointFor', { name: server.name })}
              >
                <Copy size={13} /> {t('workspacePage.panel.copyUrl')}
              </button>
              {manageHref && (
                <a
                  href={getServiceLinkHref(server.name)}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={t('workspacePage.actions.manageAccountFor', { name: server.name })}
                  className="inline-flex items-center gap-1 text-[13px] underline"
                >
                  {t('workspacePage.actions.manageAccount')} <ExternalLink size={12} />
                </a>
              )}
            </div>
          </>
        )}

        {tab === 'credentials' && (
          <CredentialPanelBody
            compact
            serverName={server.name}
            baseUrl="/credentials"
            bindings={bindings}
            error={bindingsError}
            reload={refreshWorkspace}
          />
        )}

        {tab === 'permissions' && (
          <div data-testid="service-risk">
            <p className="mb-2 text-[12px]" style={muted}>
              {t('workspacePage.risk.explanation')}
            </p>
            <div
              role="radiogroup"
              aria-label={t('workspacePage.risk.groupLabel', { name: server.name })}
              className="hub-seg sm max-w-full flex-wrap"
            >
              {TOOL_RISK_LEVELS.map((level) => {
                const allowed = isRiskChoiceAllowed(level, server.maxAllowedRisk);
                const checked = server.riskCeiling === level;
                return (
                  <button
                    key={level}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    disabled={busy || !allowed}
                    title={
                      allowed
                        ? t(`workspacePage.risk.level.${level}.hint`)
                        : t('workspacePage.risk.aboveCap')
                    }
                    data-risk-level={level}
                    onClick={() => !checked && void changeRisk(server.name, level)}
                  >
                    {t(`workspacePage.risk.level.${level}.label`)}
                    <span className="hub-mono hub-num text-[11px] opacity-70">
                      {server.riskCounts
                        ? t('workspacePage.services.toolCount', {
                            count: server.riskCounts[level] || 0,
                          })
                        : null}
                    </span>
                  </button>
                );
              })}
            </div>
            {server.riskCeilingIsDefault && server.riskCounts && (
              <p className="mt-1 text-[12px]" style={muted}>
                {t('workspacePage.risk.defaultNote')}
              </p>
            )}
            {!server.annotationsTrusted && (
              <p className="mt-1 text-[12px]" style={muted}>
                {t('workspacePage.risk.untrustedHint')}
              </p>
            )}
            {hidden > 0 && (
              <p role="status" className="mt-1 text-[12px]" style={{ color: 'var(--hub-warn)' }}>
                {t('workspacePage.risk.hiddenNotice', { count: hidden })}
              </p>
            )}
          </div>
        )}
      </div>

      {added && (
        <div className="pt-2" style={{ borderTop: '1px solid var(--hub-line-2)' }}>
          <button
            type="button"
            className="hub-btn ghost sm"
            data-testid="service-remove"
            style={{ color: 'var(--hub-err)' }}
            disabled={busy}
            onClick={() => setRemoving(true)}
          >
            <Trash2 size={13} /> {t('workspacePage.catalog.remove')}
          </button>
        </div>
      )}

      <ConfirmDialog
        isOpen={removing}
        variant="danger"
        title={t('workspacePage.catalog.removeTitle', { name: server.name })}
        message={t('workspacePage.catalog.removeMessage', { name: server.name })}
        confirmText={t('workspacePage.catalog.remove')}
        onClose={() => setRemoving(false)}
        onConfirm={() => {
          setRemoving(false);
          void setAdded(server.name, false).then((ok) => {
            if (ok) navigate('/workspace/services');
          });
        }}
      />

      {connecting && endpoints && (
        <ConnectDialog
          aggregateUrl={endpoints.aggregate}
          initial={{ service: server.name }}
          onClose={() => setConnecting(false)}
        />
      )}
    </Page>
  );
};

export default WorkspaceServicePage;
