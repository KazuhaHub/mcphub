import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ArrowLeft, ExternalLink, X } from 'lucide-react';
import { CopyBlock } from '@/components/ui/CopyBlock';
import { EndpointCopy } from '@/components/ui/EndpointCopy';
import { useToast } from '@/contexts/ToastContext';
import type { WorkspaceEndpoints, WorkspaceServer } from '@/types';
import {
  CONNECT_CLIENTS,
  buildConnectPlan,
  buildOtherSnippet,
  canChooseAuth,
  connectEntryName,
  effectiveAuth,
  getConnectClient,
  type ConnectAuthMode,
  type ConnectClient,
  type ConnectClientId,
} from '@/utils/connectClients';
import { copyText } from '@/utils/clipboard';
import { useModalLayer } from '@/hooks/useModalLayer';
import { launchPersonalOAuth } from '@/services/workspaceService';
import { resolveServiceChip } from '@/utils/workspace';
import { refreshWorkspace, useWorkspaceData } from '@/hooks/useWorkspaceData';
import { CLIENT_SNIPPET_PRESETS, type ClientSnippetId } from '@/utils/mcpClientSnippets';
import CredentialDialog from '@/components/credentials/CredentialDialog';
import { ClientIcon } from './ClientIcon';
import ConnectTile from './ConnectTile';

export type ConnectClientChoice = ConnectClientId | 'other';

export interface ConnectDialogInitial {
  /** Service to connect; `null` or absent is the aggregate endpoint. */
  service?: string | null;
  /** Ask for the service first (the "Connect a single service" entry). */
  pickService?: boolean;
  client?: ConnectClientChoice;
  /** Clients offered at the client step (the tiles that did not fit); default is all of them. */
  clientChoices?: readonly ConnectClientId[];
}

interface ConnectDialogProps {
  aggregateUrl: string;
  initial: ConnectDialogInitial;
  onClose: () => void;
}

const ConnectDialog: React.FC<ConnectDialogProps> = ({ aggregateUrl, initial, onClose }) => {
  const { t } = useTranslation();
  // The same data as the services list; a change made here refreshes it for everyone.
  const { servers, endpoints, bindings } = useWorkspaceData();
  // Service whose credential panel is open on top of this dialog.
  const [credentialService, setCredentialService] = useState<string | null>(null);
  const { showToast } = useToast();
  const panelRef = useRef<HTMLDivElement>(null);

  const [service, setService] = useState<string | null | undefined>(
    initial.pickService ? undefined : (initial.service ?? null),
  );
  const [client, setClient] = useState<ConnectClientChoice | undefined>(initial.client);
  const [signingIn, setSigningIn] = useState(false);
  const [authLink, setAuthLink] = useState<string | null>(null);
  const [wantKey, setWantKey] = useState(false);
  const [otherFormat, setOtherFormat] = useState<ClientSnippetId>('generic-mcp-servers');
  // A service picked here (rather than preselected) should not remember the narrowed client list.
  const [choices, setChoices] = useState<readonly ConnectClientId[] | undefined>(
    initial.clientChoices,
  );

  useModalLayer(panelRef, { onClose });

  const endpointByName = useMemo(
    () => new Map((endpoints?.servers ?? []).map((entry) => [entry.name, entry])),
    [endpoints],
  );
  const selectedServer = service ? servers.find((server) => server.name === service) : undefined;
  const serviceUrl = service ? (endpointByName.get(service)?.url ?? null) : aggregateUrl;
  const entryName = connectEntryName(service);

  const stage: 'service' | 'client' | 'detail' =
    service === undefined ? 'service' : client === undefined ? 'client' : 'detail';

  const clientList: readonly ConnectClient[] = choices
    ? choices.map((id) => getConnectClient(id)).filter((c): c is ConnectClient => Boolean(c))
    : CONNECT_CLIENTS;

  const activeClient = client && client !== 'other' ? getConnectClient(client) : undefined;
  const requestedAuth: ConnectAuthMode = wantKey ? 'key' : 'oauth';
  const target = useMemo(
    () => (serviceUrl ? { name: entryName, url: serviceUrl } : null),
    [entryName, serviceUrl],
  );

  const plan = useMemo(
    () =>
      activeClient && target
        ? buildConnectPlan(
            activeClient,
            target,
            { auth: requestedAuth },
            t('clientConfig.tokenPrompt'),
          )
        : null,
    [activeClient, target, requestedAuth, t],
  );
  const otherBlocks = useMemo(
    () =>
      client === 'other' && target
        ? buildOtherSnippet(otherFormat, target, requestedAuth, t('clientConfig.tokenPrompt'))
        : [],
    [client, target, otherFormat, requestedAuth, t],
  );

  // The anchor still navigates natively; the copy runs inside the same click so the browser allows it.
  const copyBeforeOpen = async (value: string) => {
    const ok = await copyText(value);
    showToast(ok ? t('connect.urlCopied') : t('common.copyFailed'), ok ? 'success' : 'error');
  };

  const back = () => {
    if (stage === 'detail') {
      setClient(undefined);
      // Going back from a client opened through the More list keeps that list.
    } else if (stage === 'client' && initial.pickService) {
      setService(undefined);
      setChoices(initial.clientChoices);
    }
  };
  const canGoBack = stage === 'detail' || (stage === 'client' && initial.pickService);

  const title =
    stage === 'service'
      ? t('connect.pickService')
      : stage === 'client'
        ? t('connect.pickClient')
        : t('connect.dialogTitle', { client: activeClient?.name ?? t('connect.other') });

  // The same state and action as the services list shows for this service.
  const credentialServers = bindings ? new Set(bindings.map((entry) => entry.serverName)) : null;
  const chipState = selectedServer
    ? resolveServiceChip(
        selectedServer,
        credentialServers,
        bindings?.find((entry) => entry.serverName === selectedServer.name),
      )
    : null;
  const showChipWarning =
    chipState !== null &&
    [
      'needs_signin',
      'needs_credentials',
      'credentials_outdated',
      'credentials_rejected',
      'contact_admin',
    ].includes(chipState.chip);
  const signIn = async (name: string) => {
    setSigningIn(true);
    try {
      const result = await launchPersonalOAuth(name);
      if (result.kind === 'link') {
        setAuthLink(result.url);
        showToast(t('workspacePage.popupBlocked'), 'error');
      } else if (result.kind === 'invalid') {
        showToast(t('workspacePage.connectFailed'), 'error');
      }
      await refreshWorkspace();
    } catch (err) {
      showToast(
        t('workspacePage.connectFailed') +
          (err instanceof Error && err.message ? ` (${err.message})` : ''),
        'error',
      );
    } finally {
      setSigningIn(false);
    }
  };
  const auth = activeClient ? effectiveAuth(activeClient, requestedAuth) : requestedAuth;
  const showAuthToggle = activeClient ? canChooseAuth(activeClient) : true;

  return (
    <div
      className="fixed inset-0 bg-black/50 z-[100] flex items-stretch justify-center sm:items-center sm:p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="hub-card flex h-full w-full flex-col outline-none !rounded-none sm:h-auto sm:max-h-[90vh] sm:max-w-xl sm:!rounded-md"
        data-testid="connect-dialog"
      >
        <div
          className="flex items-center gap-2 px-4 py-3"
          style={{ borderBottom: '1px solid var(--hub-line-2)' }}
        >
          {canGoBack && (
            <button
              type="button"
              className="hub-icon-btn sm"
              onClick={back}
              aria-label={t('connect.back')}
              title={t('connect.back')}
            >
              <ArrowLeft size={14} />
            </button>
          )}
          {activeClient && stage === 'detail' && (
            <ClientIcon icon={activeClient.icon} letter={activeClient.letter} size={28} />
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-medium">{title}</div>
            <div className="truncate text-[12px]" style={{ color: 'var(--hub-ink-3)' }}>
              {service
                ? t('connect.targetService', { name: service })
                : service === null
                  ? t('connect.targetAll')
                  : t('connect.pickServiceHint')}
            </div>
          </div>
          <button
            type="button"
            className="hub-icon-btn sm"
            onClick={onClose}
            aria-label={t('app.closeButton')}
          >
            <X size={14} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {stage === 'service' && (
            <ul className="space-y-2" aria-label={t('connect.pickService')}>
              {servers.filter((server) => server.enabled).length === 0 && (
                <li className="text-sm" style={{ color: 'var(--hub-ink-3)' }}>
                  {t('connect.noServices')}
                </li>
              )}
              {servers
                .filter((server) => server.enabled)
                .map((server) => {
                  const endpoint = endpointByName.get(server.name);
                  const ready = Boolean(endpoint?.url);
                  const reason = endpoint?.conflict
                    ? t('connect.serviceConflict')
                    : !ready
                      ? t('connect.serviceNotReady')
                      : server.description;
                  return (
                    <li key={server.name}>
                      <button
                        type="button"
                        disabled={!ready}
                        onClick={() => setService(server.name)}
                        className="flex w-full min-w-0 flex-col items-start rounded-md px-3 py-2.5 text-left transition-colors enabled:hover:bg-[var(--hub-surface-hover)] disabled:opacity-60"
                        style={{ border: '1px solid var(--hub-line)' }}
                      >
                        <span className="w-full truncate text-[13px] font-medium">
                          {server.name}
                        </span>
                        {reason && (
                          <span
                            className="w-full truncate text-[12px]"
                            style={{ color: 'var(--hub-ink-3)' }}
                          >
                            {reason}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
            </ul>
          )}

          {stage === 'client' && (
            <div
              className="grid grid-cols-3 gap-2 sm:grid-cols-4"
              role="group"
              aria-label={t('connect.pickClient')}
            >
              {clientList.map((item) => (
                <ConnectTile key={item.id} client={item} onSelect={() => setClient(item.id)} />
              ))}
              <ConnectTile label={t('connect.other')} onSelect={() => setClient('other')} />
            </div>
          )}

          {stage === 'detail' && !target && (
            <p className="text-sm" style={{ color: 'var(--hub-ink-3)' }}>
              {t('connect.serviceNotReady')}
            </p>
          )}

          {stage === 'detail' && target && (
            <>
              {showChipWarning && chipState && service && (
                <div className="hub-callout warn items-center justify-between" role="alert">
                  <span className="flex items-start gap-2">
                    <AlertTriangle size={16} aria-hidden className="mt-0.5 shrink-0" />
                    <span>
                      {t(
                        `workspacePage.panel.statusText.${chipState.reauth ? 'signin_again' : chipState.chip}`,
                      )}
                    </span>
                  </span>
                  {chipState.action === 'signin' ? (
                    authLink ? (
                      <a
                        className="hub-btn"
                        href={authLink}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {t('workspacePage.actions.openAuthorization')}
                      </a>
                    ) : (
                      <button
                        type="button"
                        className="hub-btn"
                        disabled={signingIn}
                        onClick={() => void signIn(service)}
                      >
                        {t(
                          chipState.reauth
                            ? 'workspacePage.chip.action.signinAgain'
                            : 'workspacePage.chip.action.signin',
                        )}
                      </button>
                    )
                  ) : chipState.action === 'credentials' ? (
                    <button
                      type="button"
                      className="hub-btn"
                      onClick={() => setCredentialService(service)}
                    >
                      {t(
                        chipState.chip === 'needs_credentials'
                          ? 'workspacePage.chip.action.credentials'
                          : 'workspacePage.chip.action.update',
                      )}
                    </button>
                  ) : null}
                </div>
              )}

              {showAuthToggle && (
                <label className="flex cursor-pointer items-start gap-2 text-[13px]">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={wantKey}
                    onChange={(event) => setWantKey(event.target.checked)}
                  />
                  <span>
                    {t('connect.useKey')}
                    <span className="block text-[12px]" style={{ color: 'var(--hub-ink-3)' }}>
                      {t('connect.useKeyHint')}
                    </span>
                  </span>
                </label>
              )}

              {client === 'other' && (
                <div>
                  <label htmlFor="connect-format" className="mb-1 block text-[12px]">
                    {t('connect.format')}
                  </label>
                  <select
                    id="connect-format"
                    className="hub-input w-full"
                    value={otherFormat}
                    onChange={(event) => setOtherFormat(event.target.value as ClientSnippetId)}
                  >
                    {CLIENT_SNIPPET_PRESETS.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {t(`clientConfig.clients.${preset.id}.label`)}
                      </option>
                    ))}
                  </select>
                  <p className="mt-2 text-[12px]" style={{ color: 'var(--hub-ink-3)' }}>
                    {t(`clientConfig.clients.${otherFormat}.hint`)}
                  </p>
                </div>
              )}

              {plan?.copyUrl && (
                <EndpointCopy
                  url={plan.copyUrl}
                  label={t('connect.urlLabel')}
                  ariaLabel={t('connect.urlLabel')}
                />
              )}

              {plan && (
                <ol className="list-decimal space-y-1.5 pl-5 text-[13px] leading-snug">
                  {plan.stepKeys.map((key) => (
                    <li key={key}>{t(key, { name: entryName })}</li>
                  ))}
                </ol>
              )}

              {plan?.settingsUrl && (
                <a
                  className="hub-btn primary inline-flex"
                  href={plan.settingsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={
                    plan.copyOnOpen && plan.copyUrl
                      ? () => void copyBeforeOpen(plan.copyUrl as string)
                      : undefined
                  }
                >
                  <ExternalLink size={13} /> {t(plan.settingsLabelKey ?? 'connect.openSettings')}
                </a>
              )}
              {plan?.deepLink && (
                <a className="hub-btn primary inline-flex" href={plan.deepLink.href}>
                  <ExternalLink size={13} /> {t(plan.deepLink.labelKey)}
                </a>
              )}

              {(plan ? plan.blocks : otherBlocks).map((block, index) => (
                <div key={`${block.kind}-${index}`} className="space-y-1">
                  <div className="text-[12px]" style={{ color: 'var(--hub-ink-2)' }}>
                    {t(
                      block.kind === 'command'
                        ? 'clientConfig.commandBlock'
                        : 'clientConfig.configBlock',
                    )}
                  </div>
                  <CopyBlock text={block.text} />
                </div>
              ))}

              {plan?.noteKeys.map((key) => (
                <p
                  key={key}
                  className="text-[12px] leading-[1.625]"
                  style={{ color: 'var(--hub-ink-3)' }}
                >
                  {t(key)}
                </p>
              ))}
              {client === 'other' && (
                <p className="text-[12px] leading-[1.625]" style={{ color: 'var(--hub-ink-3)' }}>
                  {t(
                    auth === 'oauth'
                      ? 'connect.notes.oauthUnverified'
                      : 'connect.notes.keyPlaceholder',
                  )}
                </p>
              )}
            </>
          )}
        </div>
      </div>
      {credentialService && (
        <CredentialDialog
          serverName={credentialService}
          onClose={() => setCredentialService(null)}
        />
      )}
    </div>
  );
};

export default ConnectDialog;
