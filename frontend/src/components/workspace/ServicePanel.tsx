import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, ExternalLink, Plug, X } from 'lucide-react';
import { StatusDot } from '@/components/ui/StatusDot';
import { CredentialPanelBody } from '@/components/credentials/CredentialDialog';
import { useModalLayer } from '@/hooks/useModalLayer';
import { refreshWorkspace, useWorkspaceSnapshot } from '@/hooks/useWorkspaceData';
import type { ToolRiskLevel, WorkspaceServer } from '@/types';
import { getSafeManageHref } from '@/utils/manageUrl';
import { getServiceLinkHref } from '@/utils/serviceLink';
import { TOOL_RISK_LEVELS, countHiddenByCeiling, isRiskChoiceAllowed } from '@/utils/toolRisk';
import {
  hasCredentialSlots,
  localizeStatusMessage,
  resolveServiceChip,
  serviceChipTone,
} from '@/utils/workspace';
import { rowButtonId, type RowAction } from './WorkspaceServiceRow';

interface ServicePanelProps {
  // The row this panel is about; endpoints, bindings and credentials come from the shared store.
  server: WorkspaceServer;
  busy: boolean;
  // Set when the authorization popup was blocked.
  authorizationUrl?: string;
  // Move to the credentials section on open (an action button or a deep link asked for it).
  focusCredentials?: boolean;
  onClose: () => void;
  onRiskChange: (name: string, riskCeiling: ToolRiskLevel) => void;
  onAction: (name: string, action: RowAction) => void;
  onCopyEndpoint: (url: string) => void;
  onConnectToAi: (name: string) => void;
}

const formatUntil = (value: string): string => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

const Section: React.FC<{
  id: string;
  title: string;
  children: React.ReactNode;
  headingRef?: React.Ref<HTMLHeadingElement>;
}> = ({ id, title, children, headingRef }) => (
  <section className="space-y-2" aria-labelledby={id} data-testid={id}>
    <h3
      id={id}
      ref={headingRef}
      tabIndex={-1}
      className="text-[12px] font-medium uppercase tracking-wide outline-none"
      style={{ color: 'var(--hub-ink-3)' }}
    >
      {title}
    </h3>
    {children}
  </section>
);

const muted = { color: 'var(--hub-ink-3)' } as const;

/**
 * Everything about one service: right-hand drawer on desktop, full-screen sheet on phones.
 * The list row only says whether the service is usable; the details are here.
 */
const ServicePanel: React.FC<ServicePanelProps> = ({
  server,
  busy,
  authorizationUrl,
  focusCredentials,
  onClose,
  onRiskChange,
  onAction,
  onCopyEndpoint,
  onConnectToAi,
}) => {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const credentialsRef = useRef<HTMLHeadingElement>(null);
  const { endpoints, bindings, bindingsError } = useWorkspaceSnapshot();
  const endpoint = endpoints?.servers.find((entry) => entry.name === server.name);
  const credentialBinding = bindings?.find((entry) => entry.serverName === server.name);
  const credentialServers = bindings ? new Set(bindings.map((entry) => entry.serverName)) : null;
  const { chip, action, reauth } = resolveServiceChip(server, credentialServers, credentialBinding);
  // Whether the service takes credentials (slots) is known from the server's own record, or from
  // the bindings once loaded. A personal sign-in has no slots, so it has no credentials section.
  const slotsKnown = server.hasCredentialSlots !== undefined || bindings !== null;
  const hasCredentials = slotsKnown && hasCredentialSlots(server, credentialServers);

  useModalLayer(panelRef, {
    onClose,
    fallbackFocus: () => document.getElementById(rowButtonId(server.name)),
  });

  const goToCredentials = () => {
    credentialsRef.current?.scrollIntoView?.({ block: 'start' });
    credentialsRef.current?.focus({ preventScroll: true });
  };
  // Opened for credentials: the panel itself has focus until it is known whether the service has
  // any; then focus moves to the credentials section, or stays when there is none.
  const wantsFocus = useRef(Boolean(focusCredentials));
  useEffect(() => {
    if (!wantsFocus.current || !slotsKnown) return;
    wantsFocus.current = false;
    if (hasCredentials) goToCredentials();
  }, [slotsKnown, hasCredentials]);

  const { code } = server.status;
  const toolsPending =
    server.toolCount === null &&
    server.requiresPersonalCredential &&
    server.credentialConfigured &&
    server.enabled &&
    (code === 'available' || code === 'not_selected');
  const hidden = countHiddenByCeiling(server.riskCounts, server.riskCeiling);
  const manageHref = getSafeManageHref(server.manageUrl);
  const titleId = `service-panel-title-${server.name}`;

  const actionLabel =
    action === 'signin'
      ? t('workspacePage.chip.action.signin')
      : chip === 'credentials_outdated' || chip === 'credentials_rejected'
        ? t('workspacePage.chip.action.update')
        : t('workspacePage.chip.action.credentials');
  const statusDetail = t(`workspacePage.panel.statusText.${reauth ? 'signin_again' : chip}`);
  // The server's own words explain a failure; they are the details the list row leaves out.
  const serverMessage =
    chip === 'unavailable' || chip === 'credentials_outdated' || chip === 'credentials_rejected'
      ? localizeStatusMessage(server.status, formatUntil)
      : '';

  return (
    <div
      className="fixed inset-0 z-[90] flex items-stretch justify-end bg-black/50"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="hub-card flex h-full w-full flex-col outline-none !rounded-none sm:max-w-[480px]"
        data-testid="service-panel"
        data-service={server.name}
      >
        <div
          className="flex items-center gap-2 px-4 py-3"
          style={{ borderBottom: '1px solid var(--hub-line-2)' }}
        >
          <h2 id={titleId} className="min-w-0 flex-1 break-words text-[15px] font-medium">
            {server.name}
          </h2>
          <button
            type="button"
            className="hub-icon-btn sm"
            onClick={onClose}
            aria-label={t('app.closeButton')}
          >
            <X size={14} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overflow-x-hidden px-4 py-4">
          {server.description && (
            <p
              className="whitespace-pre-line break-words text-[13px] leading-[1.6]"
              data-testid="service-panel-description"
              style={{ color: 'var(--hub-ink-2)' }}
            >
              {server.description}
            </p>
          )}

          <Section id="service-panel-status" title={t('workspacePage.panel.status')}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <StatusDot kind={serviceChipTone(chip)} label={t(`workspacePage.chip.${chip}`)} />
              {action && (
                <button
                  type="button"
                  className="hub-btn sm"
                  disabled={busy}
                  data-testid="service-panel-action"
                  onClick={() => {
                    if (action === 'credentials' && hasCredentials) goToCredentials();
                    else onAction(server.name, action);
                  }}
                >
                  {action === 'signin'
                    ? t(
                        reauth
                          ? 'workspacePage.chip.action.signinAgainTo'
                          : 'workspacePage.chip.action.signinTo',
                        { name: server.name },
                      )
                    : actionLabel}
                </button>
              )}
            </div>
            <p className="text-[13px]" style={{ color: 'var(--hub-ink-2)' }}>
              {statusDetail}
            </p>
            {serverMessage && (
              <p className="break-words text-[12px]" style={muted}>
                {serverMessage}
              </p>
            )}
            {authorizationUrl && (
              <a
                href={authorizationUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-[12px] underline"
              >
                {t('workspacePage.actions.openAuthorization')}
              </a>
            )}
          </Section>

          <Section id="service-panel-tools" title={t('workspacePage.panel.tools')}>
            <p className="text-[13px]">
              {server.toolCount !== null
                ? t('workspacePage.services.toolCount', { count: server.toolCount })
                : toolsPending
                  ? t('workspacePage.risk.connectedPending')
                  : t('workspacePage.panel.toolsAfterSignIn')}
            </p>
          </Section>

          <Section id="service-panel-permissions" title={t('workspacePage.panel.permissions')}>
            {!server.selected ? (
              <p className="text-[13px]" style={muted}>
                {t('workspacePage.panel.permissionsOff')}
              </p>
            ) : (
              <div data-testid="service-panel-risk">
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
                        onClick={() => !checked && onRiskChange(server.name, level)}
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
                  <p
                    role="status"
                    className="mt-1 text-[12px]"
                    style={{ color: 'var(--hub-warn)' }}
                  >
                    {t('workspacePage.risk.hiddenNotice', { count: hidden })}
                  </p>
                )}
              </div>
            )}
          </Section>

          {hasCredentials && (
            <Section
              id="service-panel-credentials"
              title={t('workspacePage.panel.credentials')}
              headingRef={credentialsRef}
            >
              <CredentialPanelBody
                serverName={server.name}
                baseUrl="/credentials"
                bindings={bindings}
                error={bindingsError}
                reload={refreshWorkspace}
              />
            </Section>
          )}

          <Section id="service-panel-actions" title={t('workspacePage.panel.actions')}>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="hub-btn primary"
                disabled={!endpoint?.url}
                onClick={() => onConnectToAi(server.name)}
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
                onClick={() => endpoint?.url && onCopyEndpoint(endpoint.url)}
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
          </Section>
        </div>
      </div>
    </div>
  );
};

export default ServicePanel;
