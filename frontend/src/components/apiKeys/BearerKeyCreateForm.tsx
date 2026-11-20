import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { Switch } from '@/components/ui/ToggleGroup';
import { MultiSelect } from '@/components/ui/MultiSelect';
import { useToast } from '@/contexts/ToastContext';
import type { BearerKey, User } from '@/types';
import type { BearerAccessType, SelectOption } from './BearerKeyRow';

export type BearerKeyCreatePayload = Pick<BearerKey, 'name'> &
  Partial<Omit<BearerKey, 'id' | 'name' | 'token'>>;

interface BearerKeyCreateFormProps {
  // 'personal' makes the caller's own user-level key; 'admin' also offers system keys and owners.
  mode: 'personal' | 'admin';
  loading: boolean;
  availableServers: SelectOption[];
  systemGroupOptions: SelectOption[];
  personalGroupOptions: SelectOption[];
  users: User[];
  onCreate: (payload: BearerKeyCreatePayload) => Promise<BearerKey | null>;
  onCreated: (key: BearerKey) => void;
  onCancel: () => void;
}

const labelClass = 'mb-1 block text-sm font-medium';

const BearerKeyCreateForm: React.FC<BearerKeyCreateFormProps> = ({
  mode,
  loading,
  availableServers,
  systemGroupOptions,
  personalGroupOptions,
  users,
  onCreate,
  onCreated,
  onCancel,
}) => {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const isAdminMode = mode === 'admin';

  const [name, setName] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [kind, setKind] = useState<'system' | 'user'>(isAdminMode ? 'system' : 'user');
  const [owner, setOwner] = useState('');
  const [accessType, setAccessType] = useState<BearerAccessType>('all');
  const [groups, setGroups] = useState<string[]>([]);
  const [servers, setServers] = useState<string[]>([]);
  const [excludedGroups, setExcludedGroups] = useState<string[]>([]);
  const [excludedServers, setExcludedServers] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const isSystem = isAdminMode && kind === 'system';
  const usesGroupSelector = accessType === 'groups' || !isSystem;
  const groupOptions = isSystem ? systemGroupOptions : personalGroupOptions;

  const changeAccessType = (value: BearerAccessType) => {
    setAccessType(value);
    // A selection that no longer applies must not travel with the next submit.
    if (value !== 'groups' && value !== 'custom') setGroups([]);
    if (value !== 'servers' && value !== 'custom') setServers([]);
  };

  const submit = async () => {
    if (!name.trim()) {
      showToast(t('settings.bearerKeyNameRequired') || 'Name is required', 'error');
      return;
    }
    if (isAdminMode && kind === 'user' && !owner) {
      showToast(t('settings.bearerKeyOwnerRequired') || 'Owner is required', 'error');
      return;
    }
    if (accessType === 'groups' && groups.length === 0) {
      showToast(t('settings.selectAtLeastOneGroup') || 'Please select at least one group', 'error');
      return;
    }
    if (isSystem && accessType === 'servers' && servers.length === 0) {
      showToast(t('settings.selectAtLeastOneServer') || 'Please select at least one server', 'error');
      return;
    }
    if (isSystem && accessType === 'custom' && groups.length === 0 && servers.length === 0) {
      showToast(
        t('settings.selectAtLeastOneGroupOrServer') || 'Please select at least one group or server',
        'error',
      );
      return;
    }
    if (
      isSystem &&
      accessType === 'exclude' &&
      excludedGroups.length === 0 &&
      excludedServers.length === 0
    ) {
      showToast(
        t('settings.selectAtLeastOneExcludedGroupOrServer') ||
          'Please select at least one group or server to exclude',
        'error',
      );
      return;
    }

    setSubmitting(true);
    try {
      const created = await onCreate({
        name,
        enabled,
        kind,
        // Personal keys are owned by the caller; the server fills that in.
        owner: isAdminMode && kind === 'user' ? owner : undefined,
        accessType,
        allowedGroups:
          (accessType === 'groups' || accessType === 'custom') && groups.length > 0
            ? groups
            : undefined,
        allowedServers:
          (accessType === 'servers' || accessType === 'custom') && servers.length > 0
            ? servers
            : undefined,
        excludedGroups:
          accessType === 'exclude' && excludedGroups.length > 0 ? excludedGroups : undefined,
        excludedServers:
          accessType === 'exclude' && excludedServers.length > 0 ? excludedServers : undefined,
      });
      if (created) onCreated(created);
    } finally {
      setSubmitting(false);
    }
  };

  const busy = loading || submitting;

  return (
    <div
      className="rounded-lg p-5"
      style={{ background: 'var(--hub-bg-2)', border: '1px solid var(--hub-line)' }}
    >
      <h3 className="mb-4 flex items-center gap-2 font-medium">
        <Plus className="h-4 w-4" style={{ color: 'var(--hub-ink-3)' }} aria-hidden="true" />
        {t('settings.addBearerKey') || 'Add bearer key'}
      </h3>

      <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-12">
        <div className="md:col-span-4">
          <label htmlFor="new-bearer-key-name" className={labelClass}>
            {t('settings.bearerKeyName') || 'Name'}
          </label>
          <input
            id="new-bearer-key-name"
            type="text"
            className="hub-input w-full"
            placeholder={t('apiKeys.namePlaceholder')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
          />
        </div>
        {isAdminMode && (
          <div className="md:col-span-4">
            <label htmlFor="new-bearer-key-kind" className={labelClass}>
              {t('settings.bearerKeyKind') || 'Key type'}
            </label>
            <select
              id="new-bearer-key-kind"
              className="hub-input w-full"
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as 'system' | 'user');
                changeAccessType('all');
              }}
              disabled={busy}
            >
              <option value="system">{t('settings.bearerKeyKindSystem') || 'System-level'}</option>
              <option value="user">{t('settings.bearerKeyKindUser') || 'User-level'}</option>
            </select>
          </div>
        )}
        {isAdminMode && kind === 'user' && (
          <div className="md:col-span-4">
            <label htmlFor="new-bearer-key-owner" className={labelClass}>
              {t('settings.bearerKeyOwner') || 'Owner'}
            </label>
            <select
              id="new-bearer-key-owner"
              className="hub-input w-full"
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              disabled={busy}
            >
              <option value="">{t('settings.bearerKeySelectOwner') || 'Select user...'}</option>
              {users.map((user) => (
                <option key={user.username} value={user.username}>
                  {user.username}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="mb-2 flex flex-wrap items-end gap-4">
        <div className="w-40">
          <span className={labelClass}>{t('settings.bearerKeyEnabled') || 'Status'}</span>
          <div
            className="flex h-8 items-center rounded-md px-3"
            style={{ background: 'var(--hub-surface)', border: '1px solid var(--hub-line)' }}
          >
            <span
              className="mr-3 text-sm"
              style={{ color: enabled ? 'var(--hub-ok)' : 'var(--hub-ink-3)' }}
            >
              {enabled ? t('common.active') : t('common.inactive')}
            </span>
            <Switch disabled={busy} checked={enabled} onCheckedChange={setEnabled} />
          </div>
        </div>

        <div className="w-48">
          <label htmlFor="new-bearer-key-access" className={labelClass}>
            {t('settings.bearerKeyAccessType') || 'Access scope'}
          </label>
          <select
            id="new-bearer-key-access"
            className="hub-input w-full"
            value={accessType}
            onChange={(e) => changeAccessType(e.target.value as BearerAccessType)}
            disabled={busy}
          >
            <option value="all">
              {t(isSystem ? 'settings.bearerKeyAccessAll' : 'settings.bearerKeyAccessUserVisibility')}
            </option>
            <option value="groups">{t('settings.bearerKeyAccessGroups') || 'Specific Groups'}</option>
            {isSystem && (
              <>
                <option value="servers">
                  {t('settings.bearerKeyAccessServers') || 'Specific Servers'}
                </option>
                <option value="custom">
                  {t('settings.bearerKeyAccessCustom') || 'Custom (Groups & Servers)'}
                </option>
                <option value="exclude">
                  {t('settings.bearerKeyAccessExclude') || 'All except selected groups/servers'}
                </option>
              </>
            )}
          </select>
        </div>

        {!isSystem && (
          <p className="w-full text-sm" style={{ color: 'var(--hub-ink-3)' }}>
            {t('settings.bearerKeyPersonalScopeHint')}
          </p>
        )}

        {accessType !== 'custom' && accessType !== 'exclude' && (
          <div className="min-w-[200px] flex-1">
            <span
              className={labelClass}
              style={{ color: accessType === 'all' ? 'var(--hub-ink-3)' : undefined }}
            >
              {usesGroupSelector
                ? t('settings.bearerKeyAllowedGroups') || 'Allowed groups'
                : t('settings.bearerKeyAllowedServers') || 'Allowed servers'}
            </span>
            <MultiSelect
              options={usesGroupSelector ? groupOptions : availableServers}
              selected={usesGroupSelector ? groups : servers}
              onChange={usesGroupSelector ? setGroups : setServers}
              placeholder={
                usesGroupSelector
                  ? t('settings.selectGroups') || 'Select groups...'
                  : t('settings.selectServers') || 'Select servers...'
              }
              disabled={busy || accessType === 'all'}
            />
          </div>
        )}

        {isSystem && accessType === 'custom' && (
          <>
            <div className="min-w-[200px] flex-1">
              <span className={labelClass}>
                {t('settings.bearerKeyAllowedGroups') || 'Allowed groups'}
              </span>
              <MultiSelect
                options={systemGroupOptions}
                selected={groups}
                onChange={setGroups}
                placeholder={t('settings.selectGroups') || 'Select groups...'}
                disabled={busy}
              />
            </div>
            <div className="min-w-[200px] flex-1">
              <span className={labelClass}>
                {t('settings.bearerKeyAllowedServers') || 'Allowed servers'}
              </span>
              <MultiSelect
                options={availableServers}
                selected={servers}
                onChange={setServers}
                placeholder={t('settings.selectServers') || 'Select servers...'}
                disabled={busy}
              />
            </div>
          </>
        )}

        {isSystem && accessType === 'exclude' && (
          <>
            <div className="min-w-[200px] flex-1">
              <span className={labelClass}>
                {t('settings.bearerKeyExcludedGroups') || 'Excluded groups'}
              </span>
              <MultiSelect
                options={systemGroupOptions}
                selected={excludedGroups}
                onChange={setExcludedGroups}
                placeholder={t('settings.selectGroups') || 'Select groups...'}
                disabled={busy}
              />
            </div>
            <div className="min-w-[200px] flex-1">
              <span className={labelClass}>
                {t('settings.bearerKeyExcludedServers') || 'Excluded servers'}
              </span>
              <MultiSelect
                options={availableServers}
                selected={excludedServers}
                onChange={setExcludedServers}
                placeholder={t('settings.selectServers') || 'Select servers...'}
                disabled={busy}
              />
            </div>
          </>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="hub-btn">
            {t('common.cancel') || 'Cancel'}
          </button>
          <button type="button" onClick={submit} disabled={busy} className="hub-btn primary">
            {t('settings.addBearerKeyButton') || 'Create Key'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default BearerKeyCreateForm;
