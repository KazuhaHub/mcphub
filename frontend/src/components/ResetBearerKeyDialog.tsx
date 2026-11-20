import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ApiResponse, BearerKey } from '@/types';
import { apiPost } from '@/utils/fetchInterceptor';
import { useModalLayer } from '@/hooks/useModalLayer';
import { TokenRevealBody } from '@/components/apiKeys/TokenRevealDialog';

interface Props {
  keyData: BearerKey;
  onClose: () => void;
  onReset: () => Promise<void>;
}

export default function ResetBearerKeyDialog({ keyData, onClose, onReset }: Props) {
  const { t } = useTranslation();
  const pending = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const copyRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);

  // Once a new token exists the dialog can only be left after confirming it was stored.
  const leave = () => {
    if (busy) return;
    if (!token || acknowledged) onClose();
  };
  useModalLayer(panelRef, { onClose: leave, skipInitialFocus: true });
  // After the layer has noted where focus was, so it can be given back there.
  useEffect(() => {
    (token ? copyRef : cancelRef).current?.focus();
  }, [token]);

  const reset = async () => {
    if (pending.current || token) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await apiPost<ApiResponse<BearerKey>>(
        `/auth/keys/${encodeURIComponent(keyData.id)}/reset`,
        {},
      );
      if (!result.success || !result.data?.token) {
        setError(result.message || t('settings.resetBearerKeyError'));
        return;
      }
      setToken(result.data.token);
      await onReset();
    } catch {
      setError(t('settings.resetBearerKeyError'));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) leave();
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={token ? 'reset-key-token-title' : 'reset-key-title'}
        aria-describedby={token ? undefined : 'reset-key-description'}
        className="hub-card p-6 max-w-xl w-full outline-none"
      >
        {token ? (
          <TokenRevealBody
            title={t('tokenReveal.titleReset', { name: keyData.name })}
            titleId="reset-key-token-title"
            token={token}
            acknowledged={acknowledged}
            onAcknowledgedChange={setAcknowledged}
            onDone={onClose}
            copyRef={copyRef}
          />
        ) : (
          <>
            <h2 id="reset-key-title" className="hub-card-title mb-2">
              {t('settings.resetBearerKey')} — {keyData.name}
            </h2>
            <p id="reset-key-description" className="hub-sub mb-4">
              {t('settings.resetBearerKeyConfirm')}
            </p>
            {error && (
              <p role="alert" className="mb-4" style={{ color: 'var(--hub-err)' }}>
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button ref={cancelRef} className="hub-btn" disabled={busy} onClick={onClose}>
                {t('common.cancel')}
              </button>
              <button className="hub-btn primary" disabled={busy} onClick={reset}>
                {t(busy ? 'common.updating' : 'common.confirm')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
