import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy } from 'lucide-react';
import { copyText } from '@/utils/clipboard';
import { useModalLayer } from '@/hooks/useModalLayer';

interface TokenRevealBodyProps {
  // Title of the dialog this sits in; `titleId` is what the dialog labels itself with.
  title: string;
  titleId: string;
  token: string;
  acknowledged: boolean;
  onAcknowledgedChange: (value: boolean) => void;
  onDone: () => void;
  // The Copy button, which the dialog around this focuses once it has registered itself.
  copyRef: React.RefObject<HTMLButtonElement | null>;
}

/**
 * What a freshly issued token looks like: shown once, copied, and confirmed as stored before the
 * dialog can be left. Shared by key creation and key reset.
 */
export const TokenRevealBody: React.FC<TokenRevealBodyProps> = ({
  title,
  titleId,
  token,
  acknowledged,
  onAcknowledgedChange,
  onDone,
  copyRef,
}) => {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  const copy = async () => {
    const ok = await copyText(token);
    setCopied(ok);
    setCopyFailed(!ok);
  };

  return (
    <>
      <h2 id={titleId} className="hub-card-title mb-3">
        {title}
      </h2>
      <div className="hub-callout warn mb-4" role="note">
        {t('tokenReveal.warning')}
      </div>
      <label htmlFor="token-reveal-value" className="mb-1 block text-sm font-medium">
        {t('settings.bearerKeyToken')}
      </label>
      <textarea
        id="token-reveal-value"
        className="hub-input hub-mono w-full break-all"
        rows={3}
        style={{ height: 'auto', minHeight: 72, resize: 'none', padding: '8px 10px' }}
        value={token}
        readOnly
        onFocus={(event) => event.target.select()}
      />
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button ref={copyRef} type="button" className="hub-btn" onClick={() => void copy()}>
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {t(copied ? 'common.copied' : 'common.copy')}
        </button>
        {copyFailed && (
          <span role="alert" className="text-sm" style={{ color: 'var(--hub-err)' }}>
            {t('tokenReveal.copyFailedManual')}
          </span>
        )}
      </div>
      <label className="mt-4 flex cursor-pointer items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={acknowledged}
          onChange={(event) => onAcknowledgedChange(event.target.checked)}
        />
        <span>{t('tokenReveal.acknowledge')}</span>
      </label>
      <div className="mt-4 flex justify-end">
        <button type="button" className="hub-btn primary" disabled={!acknowledged} onClick={onDone}>
          {t('tokenReveal.done')}
        </button>
      </div>
    </>
  );
};

interface TokenRevealDialogProps {
  // 'created' for a new key, 'reset' for a replaced token.
  kind: 'created' | 'reset';
  name: string;
  token: string;
  onClose: () => void;
}

/**
 * Shows a new token once. The token lives only in the caller's local state; leaving the dialog
 * (only possible after confirming it was stored) is the caller's cue to drop it.
 */
const TokenRevealDialog: React.FC<TokenRevealDialogProps> = ({ kind, name, token, onClose }) => {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const copyRef = useRef<HTMLButtonElement>(null);
  const [acknowledged, setAcknowledged] = useState(false);

  // Escape and the backdrop do nothing until the token is confirmed as stored.
  const leave = () => {
    if (acknowledged) onClose();
  };
  useModalLayer(panelRef, { onClose: leave, skipInitialFocus: true });
  // After the layer has noted where focus was, so it can be given back there.
  useEffect(() => copyRef.current?.focus(), []);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) leave();
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="token-reveal-title"
        data-testid="token-reveal-dialog"
        className="hub-card w-full max-w-xl p-6 outline-none"
      >
        <TokenRevealBody
          title={t(kind === 'reset' ? 'tokenReveal.titleReset' : 'tokenReveal.title', { name })}
          titleId="token-reveal-title"
          token={token}
          acknowledged={acknowledged}
          onAcknowledgedChange={setAcknowledged}
          onDone={onClose}
          copyRef={copyRef}
        />
      </div>
    </div>
  );
};

export default TokenRevealDialog;
