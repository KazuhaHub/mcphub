import React, { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';
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
  // Opens the service panel; `credentials` also moves to its credentials section.
  onOpen: (name: string, focus?: 'credentials') => void;
  onAction: (name: string, action: RowAction) => void;
}

export const rowButtonId = (name: string): string => `workspace-row-${name}`;

/**
 * One line per service: the switch, the name, one status and, only when the user must act,
 * one button. Everything else lives in the panel the row opens.
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
  const { chip, action } = resolveServiceChip(server, credentialServers, credentialBinding);

  const open = (focus?: 'credentials') => {
    // Browsers do not always focus a clicked button; focus returns here when the panel closes.
    openRef.current?.focus({ preventScroll: true });
    onOpen(server.name, focus);
  };

  const actionLabel =
    action === 'signin'
      ? t('workspacePage.chip.action.signin')
      : chip === 'credentials_outdated'
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
        open();
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
      <button
        ref={openRef}
        type="button"
        id={rowButtonId(server.name)}
        data-testid={`workspace-open-${server.name}`}
        aria-haspopup="dialog"
        className="flex min-w-0 flex-1 basis-[150px] flex-wrap items-center gap-x-3 gap-y-1 text-left"
        onClick={() => open()}
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
