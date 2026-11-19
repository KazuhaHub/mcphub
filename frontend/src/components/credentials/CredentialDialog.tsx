import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import type { MyCredentialBinding } from '@/types';
import { apiGet, type ApiResponse } from '@/utils/fetchInterceptor';
import { findCredentialBinding } from '@/utils/workspace';
import { CredentialForm } from './CredentialForm';

const messageOf = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

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
  // Called after a binding was saved, copied or deleted so the caller can refresh its view.
  onChanged?: () => void;
  onClose: () => void;
}

/**
 * Dialog on desktop and full-screen sheet on phones (like the Connect-to-AI dialog) for the
 * personal credentials of one service. It reuses the credential form and the credentials API.
 */
const CredentialDialog: React.FC<CredentialDialogProps> = ({ serverName, onChanged, onClose }) => {
  const { t } = useTranslation();
  const baseUrl = '/credentials';
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [bindings, setBindings] = useState<MyCredentialBinding[] | null>(null);
  const [error, setError] = useState('');
  const loaded = useRef(false);

  const reload = useCallback(async () => {
    try {
      const result = await apiGet<ApiResponse<MyCredentialBinding[]>>(baseUrl);
      if (!result.success) throw new Error(result.message || t('credentials.failed'));
      setBindings(result.data || []);
      setError('');
    } catch (err) {
      setError(messageOf(err, t('credentials.failed')));
    }
    // The first load is not a change; later ones follow a save, copy or delete.
    if (loaded.current) onChanged?.();
    loaded.current = true;
  }, [onChanged, t]);

  // Only on open: a changed `reload` identity must not start another first load.
  const reloadRef = useRef(reload);
  useEffect(() => {
    void reloadRef.current();
  }, []);

  useEffect(() => {
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus();
    return () => returnFocusRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

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
            baseUrl={baseUrl}
            bindings={bindings}
            error={error}
            reload={reload}
          />
        </div>
      </div>
    </div>
  );
};

export default CredentialDialog;
