import React, { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import type { MyCredentialBinding } from '@/types';
import { findCredentialBinding } from '@/utils/workspace';
import { refreshWorkspace, useWorkspaceData } from '@/hooks/useWorkspaceData';
import { useModalLayer } from '@/hooks/useModalLayer';
import { CredentialForm } from './CredentialForm';

interface CredentialPanelBodyProps {
  serverName: string;
  baseUrl: string;
  bindings: readonly MyCredentialBinding[] | null;
  error: string;
  reload: () => Promise<void>;
}

/** The content of the panel: the one selected service's form, never a list of services. */
export const CredentialPanelBody: React.FC<CredentialPanelBodyProps> = ({
  serverName,
  baseUrl,
  bindings,
  error,
  reload,
}) => {
  const { t } = useTranslation();
  const binding = bindings ? findCredentialBinding(bindings, serverName) : undefined;
  return (
    <>
      {error && (
        <p className="text-sm" style={{ color: 'var(--hub-err)' }} role="alert">
          {error}
        </p>
      )}
      {!bindings && !error && (
        <p className="text-sm" style={{ color: 'var(--hub-ink-3)' }}>
          {t('credentials.loading')}
        </p>
      )}
      {bindings && !binding && !error && (
        <p className="text-sm" style={{ color: 'var(--hub-ink-3)' }}>
          {t('credentials.notNeeded', { name: serverName })}
        </p>
      )}
      {binding && (
        <CredentialForm
          bare
          binding={binding}
          bindings={[...(bindings ?? [])]}
          baseUrl={baseUrl}
          onChange={reload}
        />
      )}
    </>
  );
};

interface CredentialDialogProps {
  serverName: string;
  onClose: () => void;
}

/**
 * Dialog on desktop and full-screen sheet on phones (like the Connect-to-AI dialog) for the
 * personal credentials of one service. It shows the shared workspace data and refreshes it after
 * every save, copy or delete, so the list and the Connect card see the change.
 */
const CredentialDialog: React.FC<CredentialDialogProps> = ({ serverName, onClose }) => {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const { bindings, bindingsError } = useWorkspaceData();

  useModalLayer(panelRef, { onClose });

  return (
    <div
      className="fixed inset-0 bg-black/50 z-[110] flex items-stretch justify-center sm:items-center sm:p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={t('credentials.panelTitle', { name: serverName })}
        className="hub-card flex h-full w-full flex-col outline-none !rounded-none sm:h-auto sm:max-h-[90vh] sm:max-w-xl sm:!rounded-md"
        data-testid="credential-dialog"
      >
        <div
          className="flex items-center gap-2 px-4 py-3"
          style={{ borderBottom: '1px solid var(--hub-line-2)' }}
        >
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-medium">
              {t('credentials.panelTitle', { name: serverName })}
            </div>
            <div className="truncate text-[12px]" style={{ color: 'var(--hub-ink-3)' }}>
              {t('credentials.panelHint')}
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
          <CredentialPanelBody
            serverName={serverName}
            baseUrl="/credentials"
            bindings={bindings}
            error={bindingsError}
            reload={refreshWorkspace}
          />
        </div>
      </div>
    </div>
  );
};

export default CredentialDialog;
