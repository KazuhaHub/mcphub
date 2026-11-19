import React, { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Search, X } from 'lucide-react';
import ServerIcon from '@/components/ServerIcon';
import { useModalLayer } from '@/hooks/useModalLayer';
import { useServiceActions } from '@/hooks/useServiceActions';
import { useWorkspaceData } from '@/hooks/useWorkspaceData';
import { searchCatalog } from '@/utils/workspace';

interface AddServiceDialogProps {
  onClose: () => void;
  /** Called after a service was added, with its name. */
  onAdded?: (name: string) => void;
}

/**
 * The catalog: services the user may use and has not added yet, searchable by name, description
 * and tags. A dialog on desktop, the full screen on a phone. Adding puts the service in the
 * user's list (switched on) and leaves it out of this list.
 */
const AddServiceDialog: React.FC<AddServiceDialogProps> = ({ onClose, onAdded }) => {
  const { t } = useTranslation();
  const { servers } = useWorkspaceData();
  const { pending, setAdded } = useServiceActions();
  const [query, setQuery] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useModalLayer(panelRef, { onClose, skipInitialFocus: true });
  React.useEffect(() => searchRef.current?.focus(), []);

  const matches = useMemo(() => searchCatalog(servers, query), [servers, query]);
  const anyLeft = servers.some((server) => server.added === false);

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
        aria-label={t('workspacePage.catalog.title')}
        data-testid="add-service-dialog"
        className="hub-card flex h-full w-full flex-col outline-none !rounded-none sm:h-auto sm:max-h-[85vh] sm:max-w-xl sm:!rounded-md"
      >
        <div
          className="flex items-center gap-2 px-4 py-3"
          style={{ borderBottom: '1px solid var(--hub-line-2)' }}
        >
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-medium">
              {t('workspacePage.catalog.title')}
            </div>
            <div className="truncate text-[12px]" style={{ color: 'var(--hub-ink-3)' }}>
              {t('workspacePage.catalog.subtitle')}
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

        <div className="px-4 pt-3">
          <label className="relative block">
            <span className="sr-only">{t('workspacePage.catalog.searchLabel')}</span>
            <Search
              size={14}
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
              style={{ color: 'var(--hub-ink-3)' }}
            />
            <input
              ref={searchRef}
              type="search"
              className="hub-input w-full"
              style={{ paddingLeft: 32 }}
              placeholder={t('workspacePage.catalog.searchPlaceholder')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              data-testid="catalog-search"
            />
          </label>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {matches.length === 0 ? (
            <p
              className="py-8 text-center text-sm"
              style={{ color: 'var(--hub-ink-3)' }}
              data-testid="catalog-empty"
              role="status"
            >
              {t(!anyLeft ? 'workspacePage.catalog.allAdded' : 'workspacePage.catalog.noMatch')}
            </p>
          ) : (
            <ul className="space-y-2" aria-label={t('workspacePage.catalog.title')}>
              {matches.map((server) => (
                <li
                  key={server.name}
                  data-testid={`catalog-item-${server.name}`}
                  className="flex min-w-0 items-center gap-3 rounded-md px-3 py-2.5"
                  style={{ border: '1px solid var(--hub-line)' }}
                >
                  <ServerIcon name={server.name} icon={server.icon} size={28} />
                  <div className="min-w-0 flex-1">
                    <div className="break-words text-[13px] font-medium">{server.name}</div>
                    {server.description && (
                      <div
                        className="line-clamp-1 text-[12px]"
                        style={{ color: 'var(--hub-ink-3)' }}
                        title={server.description}
                      >
                        {server.description}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    className="hub-btn sm shrink-0"
                    data-testid={`catalog-add-${server.name}`}
                    disabled={pending.has(server.name)}
                    aria-label={t('workspacePage.catalog.addNamed', { name: server.name })}
                    onClick={() =>
                      void setAdded(server.name, true).then((ok) => ok && onAdded?.(server.name))
                    }
                  >
                    <Plus size={13} /> {t('workspacePage.catalog.addShort')}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};

export default AddServiceDialog;
