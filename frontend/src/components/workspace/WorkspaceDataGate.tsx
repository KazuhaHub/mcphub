import React from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';
import { refreshWorkspace, useWorkspaceData } from '@/hooks/useWorkspaceData';

/**
 * Shows what the workspace data is doing while it has nothing to show (loading, or failed to
 * load) and the children once it has. Shared by Home and Services, which read the same store.
 */
const WorkspaceDataGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { t } = useTranslation();
  const { loaded, error } = useWorkspaceData();

  if (!loaded && !error) {
    return (
      <div className="space-y-4" role="status" aria-busy="true">
        <span className="sr-only">{t('workspacePage.loading')}</span>
        <span className="hub-skeleton h-11 w-full" aria-hidden />
        <div className="hub-card divide-y divide-[var(--hub-line-2)]" aria-hidden>
          {[0, 1, 2].map((row) => (
            <div key={row} className="flex items-center gap-4 px-4 py-4">
              <span className="hub-skeleton h-[18px] w-[30px] rounded-full" />
              <div className="flex-1 space-y-2">
                <span className="hub-skeleton h-3.5 w-40" />
                <span className="hub-skeleton h-3 w-64 max-w-full" />
              </div>
              <span className="hub-skeleton h-8 w-20" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error && !loaded) {
    return (
      <div className="hub-callout err items-center justify-between" role="alert">
        <div>
          <div className="font-medium">
            {t(error.disabled ? 'workspacePage.disabled' : 'workspacePage.loadFailed')}
          </div>
          {error.detail && !error.disabled && (
            <div className="text-[12px]" style={{ color: 'var(--hub-ink-3)' }}>
              {error.detail}
            </div>
          )}
        </div>
        <button
          type="button"
          className="hub-btn"
          onClick={() => (error.disabled ? window.location.reload() : void refreshWorkspace())}
        >
          <RefreshCw size={13} />{' '}
          {t(error.disabled ? 'workspacePage.reload' : 'workspacePage.retry')}
        </button>
      </div>
    );
  }

  return <>{children}</>;
};

export default WorkspaceDataGate;
