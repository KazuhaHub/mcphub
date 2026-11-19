import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import ServerIcon from '@/components/ServerIcon';
import { useModalLayer } from '@/hooks/useModalLayer';
import { fetchUserServices, saveUserService } from '@/services/workspaceService';
import type { UserServiceEntry } from '@/types';

interface UserServicesDialogProps {
  username: string;
  onClose: () => void;
}

/**
 * Administrator: the services one user can see, each with "Added" (is it in their list) and
 * "Enabled" (is it switched on in their endpoint). A change applies at once and the user can
 * still change both themselves afterwards.
 */
const UserServicesDialog: React.FC<UserServicesDialogProps> = ({ username, onClose }) => {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<UserServiceEntry[] | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const panelRef = useRef<HTMLDivElement>(null);
  useModalLayer(panelRef, { onClose });

  const load = useCallback(async () => {
    try {
      setEntries(await fetchUserServices(username));
      setError('');
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : t('userServices.loadFailed'));
    }
  }, [username, t]);
  useEffect(() => {
    void load();
  }, [load]);

  const change = async (
    entry: UserServiceEntry,
    patch: { added?: boolean; selected?: boolean },
  ) => {
    setPending((current) => new Set(current).add(entry.name));
    try {
      await saveUserService(username, entry.name, patch);
      await load();
    } catch {
      setError(t('userServices.saveFailed', { name: entry.name }));
    } finally {
      setPending((current) => {
        const next = new Set(current);
        next.delete(entry.name);
        return next;
      });
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-stretch justify-center bg-black/50 sm:items-center sm:p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={t('userServices.title', { username })}
        data-testid="user-services-dialog"
        className="hub-card flex h-full w-full flex-col outline-none !rounded-none sm:h-auto sm:max-h-[85vh] sm:max-w-2xl sm:!rounded-md"
      >
        <div
          className="flex items-center gap-2 px-4 py-3"
          style={{ borderBottom: '1px solid var(--hub-line-2)' }}
        >
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-medium">
              {t('userServices.title', { username })}
            </div>
            <div className="text-[12px]" style={{ color: 'var(--hub-ink-3)' }}>
              {t('userServices.description')}
            </div>
          </div>
          <button
            type="button"
            className="hub-icon-btn"
            onClick={onClose}
            aria-label={t('app.closeButton')}
          >
            <X size={14} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {error && (
            <div className="hub-callout err m-4" role="alert">
              {error}
            </div>
          )}
          {entries === null && !error && (
            <p className="p-6 text-center text-sm" style={{ color: 'var(--hub-ink-3)' }}>
              {t('app.loading')}
            </p>
          )}
          {entries?.length === 0 && (
            <p className="p-6 text-center text-sm" style={{ color: 'var(--hub-ink-3)' }}>
              {t('userServices.empty')}
            </p>
          )}
          {entries && entries.length > 0 && (
            <ul>
              {entries.map((entry, index) => (
                <li
                  key={entry.name}
                  data-testid={`user-service-${entry.name}`}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3"
                  style={index ? { borderTop: '1px solid var(--hub-line-2)' } : undefined}
                >
                  <ServerIcon name={entry.name} icon={entry.icon} size={24} />
                  <div className="min-w-0 flex-1 basis-[140px]">
                    <div className="break-words text-[13px] font-medium">{entry.name}</div>
                    {entry.description && (
                      <div
                        className="line-clamp-1 text-[12px]"
                        style={{ color: 'var(--hub-ink-3)' }}
                      >
                        {entry.description}
                      </div>
                    )}
                  </div>
                  <div className="flex w-full items-center gap-5 pl-9 sm:w-auto sm:pl-0">
                    <label className="flex items-center gap-2 text-[12px]">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={entry.added}
                        data-testid={`user-service-added-${entry.name}`}
                        aria-label={t('userServices.addedFor', { name: entry.name })}
                        className={'hub-switch compact' + (entry.added ? ' on' : '')}
                        disabled={pending.has(entry.name)}
                        onClick={() => void change(entry, { added: !entry.added })}
                      />
                      {t('userServices.added')}
                    </label>
                    <label className="flex items-center gap-2 text-[12px]">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={entry.selected}
                        data-testid={`user-service-enabled-${entry.name}`}
                        aria-label={t('userServices.enabledFor', { name: entry.name })}
                        className={'hub-switch compact' + (entry.selected ? ' on' : '')}
                        disabled={pending.has(entry.name) || !entry.added}
                        onClick={() => void change(entry, { selected: !entry.selected })}
                      />
                      {t('userServices.enabled')}
                    </label>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};

export default UserServicesDialog;
