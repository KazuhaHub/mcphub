import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ServerIcon from '@/components/ServerIcon';
import { SERVER_ICON_ACCEPT, prepareServerIcon } from '@/utils/serverIcon';

interface ServerIconFieldProps {
  name: string;
  /** The stored icon's URL, when the server has one. */
  stored?: string;
  /** The pending choice: a data: URL to set, '' to remove, undefined for no change. */
  value?: string;
  onChange: (value: string | undefined) => void;
}

/** Upload, replace or remove a server's icon, with a preview of what will be saved. */
const ServerIconField: React.FC<ServerIconFieldProps> = ({ name, stored, value, onChange }) => {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');

  const shown = value === undefined ? stored : value || undefined;

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    const result = await prepareServerIcon(file);
    if (result.ok) onChange(result.dataUrl);
    else setError(t(`settings.branding.error.${result.error}`));
  };

  return (
    <div className="md:col-span-2" data-testid="server-icon-field">
      <label
        className="block text-sm font-medium mb-1.5 text-[var(--hub-ink-2)]"
        htmlFor="server-icon"
      >
        {t('server.icon')}
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <ServerIcon name={name || '?'} icon={shown} size={48} />
        <input
          ref={input}
          id="server-icon"
          type="file"
          accept={SERVER_ICON_ACCEPT}
          className="sr-only"
          data-testid="server-icon-input"
          onChange={(event) => {
            void choose(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
        <button type="button" className="hub-btn sm" onClick={() => input.current?.click()}>
          {shown ? t('server.iconReplace') : t('server.iconUpload')}
        </button>
        {shown && (
          <button
            type="button"
            className="hub-btn sm"
            data-testid="server-icon-remove"
            // Removing an icon that was never saved just drops the pending choice.
            onClick={() => onChange(stored && value !== '' ? '' : undefined)}
          >
            {t('server.iconRemove')}
          </button>
        )}
      </div>
      <p className="mt-1 text-xs text-[var(--hub-ink-3)]">{t('server.iconHint')}</p>
      {error && (
        <p role="alert" className="mt-1 text-xs" style={{ color: 'var(--hub-err)' }}>
          {error}
        </p>
      )}
    </div>
  );
};

export default ServerIconField;
