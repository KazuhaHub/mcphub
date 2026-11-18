import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import { copyText } from '@/utils/clipboard';

export const CopyBlock: React.FC<{ text: string }> = ({ text }) => {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    if (!(await copyText(text))) {
      showToast(t('common.copyFailed'), 'error');
      return;
    }
    setCopied(true);
    showToast(t('common.copySuccess'), 'success');
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className="relative">
      <pre
        className="hub-mono overflow-x-auto rounded-md p-3 pr-12 text-[13px] leading-normal"
        style={{ background: 'var(--hub-bg-2)', border: '1px solid var(--hub-line)' }}
      >
        {text}
      </pre>
      <button
        type="button"
        className="hub-icon-btn absolute right-2 top-2"
        onClick={() => void onCopy()}
        aria-label={t('common.copy')}
        title={t('common.copy')}
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
    </div>
  );
};

export default CopyBlock;
