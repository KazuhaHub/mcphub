import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { useSettings } from '@/contexts/SettingsContext';
import { useAuth } from '@/contexts/AuthContext';
import { useServerContext } from '@/contexts/ServerContext';
import { useGroupData } from '@/hooks/useGroupData';
import { apiGet } from '@/utils/fetchInterceptor';
import {
  filterBearerKeysByScopeFilter,
  getBearerKeyScopeFilterOptions,
  type BearerKeyScopeFilterValue,
} from '@/utils/bearerKeyScopeFilter';
import ResetBearerKeyDialog from '@/components/ResetBearerKeyDialog';
import type { BearerKey, User } from '@/types';
import BearerKeyCreateForm from './BearerKeyCreateForm';
import BearerKeyTable from './BearerKeyTable';
import type { BearerKeyEditPayload } from './BearerKeyRow';
import TokenRevealDialog from './TokenRevealDialog';

interface BearerKeysPanelProps {
  // 'personal' lists and creates the signed-in person's own keys; 'admin' manages every key.
  mode: 'personal' | 'admin';
}

const parseCommaSeparated = (value: string): string[] | undefined => {
  const parts = value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return parts.length > 0 ? parts : undefined;
};

const BearerKeysPanel: React.FC<BearerKeysPanelProps> = ({ mode }) => {
  const { t } = useTranslation();
  const { auth } = useAuth();
  const { allServers: servers } = useServerContext();
  const { groups } = useGroupData();
  const {
    bearerKeys,
    loading,
    createBearerKey,
    updateBearerKey,
    deleteBearerKey,
    refreshBearerKeys,
  } = useSettings();
  const isAdminMode = mode === 'admin';
  const me = auth.user?.username;

  const [showCreate, setShowCreate] = useState(false);
  const [keyToReset, setKeyToReset] = useState<BearerKey | null>(null);
  // The plaintext token lives here only, until the person confirms it was stored.
  const [revealed, setRevealed] = useState<{ name: string; token: string } | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [scopeFilter, setScopeFilter] = useState<BearerKeyScopeFilterValue>('all');

  useEffect(() => {
    void refreshBearerKeys();
    // Read once when the panel opens.
  }, []);

  useEffect(() => {
    if (!isAdminMode) return;
    apiGet<{ success: boolean; data?: User[] }>('/users')
      .then((result) => {
        if (result.success && Array.isArray(result.data)) setUsers(result.data);
      })
      .catch(() => setUsers([]));
  }, [isAdminMode]);

  // An administrator's list call returns everyone's keys, so the personal list is cut to one's own.
  const keys = useMemo(
    () =>
      isAdminMode
        ? bearerKeys
        : bearerKeys.filter((key) => key.kind === 'user' && key.owner === me),
    [isAdminMode, bearerKeys, me],
  );

  const scopeOptions = useMemo(
    () => getBearerKeyScopeFilterOptions(t, keys, users),
    [t, keys, users],
  );
  const visibleKeys = useMemo(
    () => (isAdminMode ? filterBearerKeysByScopeFilter(keys, scopeFilter) : keys),
    [isAdminMode, keys, scopeFilter],
  );

  useEffect(() => {
    if (!scopeOptions.some((option) => option.value === scopeFilter)) setScopeFilter('all');
  }, [scopeFilter, scopeOptions]);

  const availableServers = servers.map((server) => ({ value: server.name, label: server.name }));
  const personalGroupOptions = groups.map((group) => ({ value: group.id, label: group.name }));
  const systemGroupOptions = groups.map((group) => ({ value: group.name, label: group.name }));

  const handleSave = async (id: string, payload: BearerKeyEditPayload) => {
    await updateBearerKey(id, {
      name: payload.name,
      enabled: payload.enabled,
      accessType: payload.accessType,
      allowedGroups: parseCommaSeparated(payload.allowedGroups),
      allowedServers: parseCommaSeparated(payload.allowedServers),
      excludedGroups: parseCommaSeparated(payload.excludedGroups),
      excludedServers: parseCommaSeparated(payload.excludedServers),
    });
    await refreshBearerKeys();
  };

  const handleDelete = async (id: string) => {
    await deleteBearerKey(id);
    await refreshBearerKeys();
  };

  return (
    <div className="space-y-4" data-testid={`bearer-keys-panel-${mode}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {isAdminMode && (
          <p className="text-sm" style={{ color: 'var(--hub-ink-3)' }}>
            {t('settings.bearerKeysSectionDescription')}
          </p>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-3">
          {isAdminMode && keys.length > 0 && scopeOptions.length > 1 && (
            <div className="flex items-center gap-2">
              <label
                htmlFor="bearer-key-scope-filter"
                className="whitespace-nowrap text-sm"
                style={{ color: 'var(--hub-ink-2)' }}
              >
                {t('settings.bearerKeyScopeFilter') || 'Filter by scope'}
              </label>
              <select
                id="bearer-key-scope-filter"
                className="hub-input min-w-48"
                value={scopeFilter}
                onChange={(e) => setScopeFilter(e.target.value as BearerKeyScopeFilterValue)}
              >
                {scopeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          {!showCreate && (
            <button type="button" className="hub-btn primary" onClick={() => setShowCreate(true)}>
              <Plus className="h-3.5 w-3.5" />
              {t('settings.addBearerKey') || 'Add bearer key'}
            </button>
          )}
        </div>
      </div>

      {showCreate && (
        <BearerKeyCreateForm
          mode={mode}
          loading={loading}
          availableServers={availableServers}
          systemGroupOptions={systemGroupOptions}
          personalGroupOptions={personalGroupOptions}
          users={users}
          onCreate={createBearerKey}
          onCreated={(created) => {
            setShowCreate(false);
            setRevealed({ name: created.name, token: created.token });
            void refreshBearerKeys();
          }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {keys.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--hub-ink-3)' }}>
          {t('settings.noBearerKeys') || 'No bearer keys configured yet.'}
        </p>
      ) : (
        <BearerKeyTable
          keys={visibleKeys}
          loading={loading}
          availableServers={availableServers}
          systemGroupOptions={systemGroupOptions}
          personalGroupOptions={personalGroupOptions}
          isAdmin={isAdminMode}
          onSave={handleSave}
          onDelete={handleDelete}
          onReset={setKeyToReset}
        />
      )}

      {keyToReset && (
        <ResetBearerKeyDialog
          keyData={keyToReset}
          onClose={() => setKeyToReset(null)}
          onReset={refreshBearerKeys}
        />
      )}

      {revealed && (
        <TokenRevealDialog
          kind="created"
          name={revealed.name}
          token={revealed.token}
          onClose={() => setRevealed(null)}
        />
      )}
    </div>
  );
};

export default BearerKeysPanel;
