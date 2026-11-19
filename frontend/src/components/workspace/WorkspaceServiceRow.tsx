import React, { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';
import ServerIcon from '@/components/ServerIcon';
import { StatusDot } from '@/components/ui/StatusDot';
import type { MyCredentialBinding, WorkspaceServer } from '@/types';
import { resolveServiceChip, serviceChipTone } from '@/utils/workspace';

export type RowAction = 'signin' | 'credentials';

interface WorkspaceServiceRowProps {
  server: WorkspaceServer;
  credentialServers: ReadonlySet<string> | null;
  // The user's binding for this service, when it takes personal credentials.
  credentialBinding?: MyCredentialBinding;
  busy: boolean;
  onToggle: (name: string, selected: boolean) => void;
  // Goes to the service's page.
  onOpen: (name: string) => void;
  onAction: (name: string, action: RowAction) => void;
}

/**
 * One line per service: the switch, the name, one status and, only when the user must act,
 * one button. Everything else lives on the service's page the row opens.
 */
const WorkspaceServiceRow: React.FC<WorkspaceServiceRowProps> = ({
  server,
  credentialServers,
  credentialBinding,
  busy,
  onToggle,
  onOpen,
  onAction,
}) => {
  const { t } = useTranslation();
  const openRef = useRef<HTMLButtonElement>(null);
  const { chip, action, reauth } = resolveServiceChip(server, credentialServers, credentialBinding);

  const actionLabel =
    action === 'signin'
      ? t(reauth ? 'workspacePage.chip.action.signinAgain' : 'workspacePage.chip.action.signin')
      : chip === 'credentials_outdated' || chip === 'credentials_rejected'
        ? t('workspacePage.chip.action.update')
        : t('workspacePage.chip.action.credentials');

  return (
    <li
      className="hub-service-row flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3"
      style={{ borderTop: '1px solid var(--hub-line-2)' }}
      data-testid={`workspace-service-${server.name}`}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest('[data-row-stop]')) return;
        if (event.target === openRef.current || openRef.current?.contains(event.target as Node)) {
          return;
        }
        onOpen(server.name);
      }}
    >
      <button
        type="button"
        role="switch"
        data-row-stop
        aria-checked={server.selected}
        aria-label={t('workspacePage.services.toggleFor', { name: server.name })}
        className={'hub-switch compact' + (server.selected ? ' on' : '')}
        disabled={busy}
        onClick={() => onToggle(server.name, !server.selected)}
      />
      <ServerIcon name={server.name} icon={server.icon} size={24} />
      <button
        ref={openRef}
        type="button"
        data-testid={`workspace-open-${server.name}`}
        className="flex min-w-0 flex-1 basis-[120px] flex-wrap items-center gap-x-3 gap-y-1 text-left"
        onClick={() => onOpen(server.name)}
      >
        <span className="min-w-0 break-words font-medium">{server.name}</span>
        <span data-testid={`workspace-chip-${server.name}`} data-chip={chip}>
          <StatusDot kind={serviceChipTone(chip)} label={t(`workspacePage.chip.${chip}`)} />
        </span>
      </button>
      {action && (
        <button
          type="button"
          data-row-stop
          className="hub-btn sm shrink-0"
          data-testid={`workspace-action-${server.name}`}
          data-action={action}
          disabled={busy}
          aria-label={`${actionLabel}: ${server.name}`}
          onClick={() => onAction(server.name, action)}
        >
          {actionLabel}
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
};

export default WorkspaceServiceRow;
