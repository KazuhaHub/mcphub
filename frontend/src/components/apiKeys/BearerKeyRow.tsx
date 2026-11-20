import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Edit, RefreshCw, Trash2, X } from 'lucide-react';
import { Switch } from '@/components/ui/ToggleGroup';
import { MultiSelect } from '@/components/ui/MultiSelect';
import { useToast } from '@/contexts/ToastContext';
import type { BearerKey } from '@/types';

export type BearerAccessType = 'all' | 'groups' | 'servers' | 'custom' | 'exclude';

export interface BearerKeyEditPayload {
  name: string;
  enabled: boolean;
  accessType: BearerAccessType;
  allowedGroups: string;
  allowedServers: string;
  excludedGroups: string;
  excludedServers: string;
}

export interface SelectOption {
  value: string;
  label: string;
}

interface BearerKeyRowProps {
  keyData: BearerKey;
  loading: boolean;
  availableServers: SelectOption[];
  availableGroups: SelectOption[];
  isAdmin: boolean;
  onSave: (id: string, payload: BearerKeyEditPayload) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onReset: (key: BearerKey) => void;
}

const cellClass = 'px-4 py-2.5 align-top';
const labelClass = 'mb-1 block text-sm font-medium';

const BearerKeyRow: React.FC<BearerKeyRowProps> = ({
  keyData,
  loading,
  availableServers,
  availableGroups,
  isAdmin,
  onSave,
  onDelete,
  onReset,
}) => {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(keyData.name);
  const [enabled, setEnabled] = useState<boolean>(keyData.enabled);
  const [accessType, setAccessType] = useState<BearerAccessType>(keyData.accessType || 'all');
  const [selectedGroups, setSelectedGroups] = useState<string[]>(keyData.allowedGroups || []);
  const [selectedServers, setSelectedServers] = useState<string[]>(keyData.allowedServers || []);
  const [excludedGroups, setExcludedGroups] = useState<string[]>(keyData.excludedGroups || []);
  const [excludedServers, setExcludedServers] = useState<string[]>(keyData.excludedServers || []);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!isEditing) {
      setName(keyData.name);
      setEnabled(keyData.enabled);
      setAccessType(keyData.accessType || 'all');
      setSelectedGroups(keyData.allowedGroups || []);
      setSelectedServers(keyData.allowedServers || []);
      setExcludedGroups(keyData.excludedGroups || []);
      setExcludedServers(keyData.excludedServers || []);
    }
  }, [keyData, isEditing]);

  const { showToast } = useToast();
  const isSystemKey = (keyData.kind ?? 'system') === 'system';

  const handleSave = async () => {
    if (accessType === 'groups' && selectedGroups.length === 0) {
      showToast(t('settings.selectAtLeastOneGroup') || 'Please select at least one group', 'error');
      return;
    }
    if (isSystemKey && accessType === 'servers' && selectedServers.length === 0) {
      showToast(
        t('settings.selectAtLeastOneServer') || 'Please select at least one server',
        'error',
      );
      return;
    }
    if (isSystemKey && accessType === 'custom' && selectedGroups.length === 0 && selectedServers.length === 0) {
      showToast(
        t('settings.selectAtLeastOneGroupOrServer') || 'Please select at least one group or server',
        'error',
      );
      return;
    }
    if (isSystemKey && accessType === 'exclude' && excludedGroups.length === 0 && excludedServers.length === 0) {
      showToast(
        t('settings.selectAtLeastOneExcludedGroupOrServer') ||
          'Please select at least one group or server to exclude',
        'error',
      );
      return;
    }

    setSaving(true);
    try {
      await onSave(keyData.id, {
        name,
        enabled,
        accessType,
        allowedGroups: selectedGroups.join(', '),
        allowedServers: selectedServers.join(', '),
        excludedGroups: excludedGroups.join(', '),
        excludedServers: excludedServers.join(', '),
      });
      setIsEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(t('settings.deleteBearerKeyConfirm') || 'Delete this key?')) {
      return;
    }
    setDeleting(true);
    try {
      await onDelete(keyData.id);
    } finally {
      setDeleting(false);
    }
  };

  const isGroupsMode = accessType === 'groups' || !isSystemKey;
  const isCustomMode = accessType === 'custom';
  const isExcludeMode = accessType === 'exclude';

  // Helper function to format access type display text
  const formatAccessTypeDisplay = (key: BearerKey): string => {
    if ((key.kind ?? 'system') === 'user' && key.accessType === 'all') {
      return `${t('settings.bearerKeyAccessUserVisibility') || 'User visibility'}${key.owner ? ` · ${key.owner}` : ''}`;
    }
    if (key.accessType === 'all') {
      return t('settings.bearerKeyAccessAll') || 'All Resources';
    }
    if (key.accessType === 'groups') {
      return `${t('settings.bearerKeyAccessGroups') || 'Groups'}: ${(key.allowedGroups ?? []).map((id) => availableGroups.find((group) => group.value === id)?.label ?? id).join(', ')}`;
    }
    if (key.accessType === 'servers') {
      return `${t('settings.bearerKeyAccessServers') || 'Servers'}: ${key.allowedServers}`;
    }
    if (key.accessType === 'custom') {
      const parts: string[] = [];
      if (key.allowedGroups && key.allowedGroups.length > 0) {
        parts.push(`${t('settings.bearerKeyAccessGroups') || 'Groups'}: ${key.allowedGroups}`);
      }
      if (key.allowedServers && key.allowedServers.length > 0) {
        parts.push(`${t('settings.bearerKeyAccessServers') || 'Servers'}: ${key.allowedServers}`);
      }
      return `${t('settings.bearerKeyAccessCustom') || 'Custom'}: ${parts.join('; ')}`;
    }
    if (key.accessType === 'exclude') {
      const parts: string[] = [];
      if (key.excludedGroups && key.excludedGroups.length > 0) {
        parts.push(
          `${t('settings.bearerKeyExcludedGroups') || 'Excluded groups'}: ${key.excludedGroups}`,
        );
      }
      if (key.excludedServers && key.excludedServers.length > 0) {
        parts.push(
          `${t('settings.bearerKeyExcludedServers') || 'Excluded servers'}: ${key.excludedServers}`,
        );
      }
      return `${t('settings.bearerKeyAccessExclude') || 'All except'}: ${parts.join('; ')}`;
    }
    return '';
  };

  const editForm = isEditing ? (
    <tr style={{ borderTop: '1px solid var(--hub-line)' }}>
      <td colSpan={5} className="p-0">
        <div className="p-5" style={{ background: 'var(--hub-bg-2)' }}>
          <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-12">
            <div className="md:col-span-3">
              <label htmlFor={`bearer-key-name-${keyData.id}`} className={labelClass}>
                {t('settings.bearerKeyName') || 'Name'}
              </label>
              <input
                id={`bearer-key-name-${keyData.id}`}
                type="text"
                className="hub-input w-full"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={loading}
              />
            </div>
            <div className="md:col-span-9">
              <span className={labelClass}>{t('settings.bearerKeyToken') || 'Token'}</span>
              <div
                className="hub-mono py-2 text-sm"
                style={{ color: 'var(--hub-ink-3)' }}
              >
                {keyData.tokenPrefix ? `${keyData.tokenPrefix}...` : keyData.token}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-4">
            <div className="w-40">
              <span className={labelClass}>{t('settings.bearerKeyEnabled') || 'Status'}</span>
              <div
                className="flex h-8 items-center rounded-md px-3"
                style={{
                  background: 'var(--hub-surface)',
                  border: '1px solid var(--hub-line)',
                }}
              >
                <span
                  className="mr-3 text-sm"
                  style={{ color: enabled ? 'var(--hub-ok)' : 'var(--hub-ink-3)' }}
                >
                  {enabled ? t('common.active') : t('common.inactive')}
                </span>
                <Switch
                  disabled={loading}
                  checked={enabled}
                  onCheckedChange={(checked) => setEnabled(checked)}
                />
              </div>
            </div>

            <div className="w-48">
              <label htmlFor={`bearer-key-access-${keyData.id}`} className={labelClass}>
                {t('settings.bearerKeyAccessType') || 'Access scope'}
              </label>
              <select
                id={`bearer-key-access-${keyData.id}`}
                className="hub-input w-full"
                value={accessType}
                onChange={(e) => setAccessType(e.target.value as BearerAccessType)}
                disabled={loading}
              >
                <option value="all">
                  {t(isSystemKey ? 'settings.bearerKeyAccessAll' : 'settings.bearerKeyAccessUserVisibility')}
                </option>
                <option value="groups">
                  {t('settings.bearerKeyAccessGroups') || 'Specific Groups'}
                </option>
                {isSystemKey && (
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

            {!isSystemKey && (
              <p className="w-full text-sm" style={{ color: 'var(--hub-ink-3)' }}>
                {t('settings.bearerKeyPersonalScopeHint')}
              </p>
            )}

            {/* Show single selector for groups or servers mode */}
            {!isCustomMode && !isExcludeMode && (
              <div className="min-w-[200px] flex-1">
                <span
                  className={labelClass}
                  style={{ color: accessType === 'all' ? 'var(--hub-ink-3)' : undefined }}
                >
                  {isGroupsMode
                    ? t('settings.bearerKeyAllowedGroups') || 'Allowed groups'
                    : t('settings.bearerKeyAllowedServers') || 'Allowed servers'}
                </span>
                <MultiSelect
                  options={isGroupsMode ? availableGroups : availableServers}
                  selected={isGroupsMode ? selectedGroups : selectedServers}
                  onChange={isGroupsMode ? setSelectedGroups : setSelectedServers}
                  placeholder={
                    isGroupsMode
                      ? t('settings.selectGroups') || 'Select groups...'
                      : t('settings.selectServers') || 'Select servers...'
                  }
                  disabled={loading || accessType === 'all'}
                />
              </div>
            )}

            {/* Show both selectors for custom mode */}
            {isAdmin && isSystemKey && isCustomMode && (
              <>
                <div className="min-w-[200px] flex-1">
                  <span className={labelClass}>
                    {t('settings.bearerKeyAllowedGroups') || 'Allowed groups'}
                  </span>
                  <MultiSelect
                    options={availableGroups}
                    selected={selectedGroups}
                    onChange={setSelectedGroups}
                    placeholder={t('settings.selectGroups') || 'Select groups...'}
                    disabled={loading}
                  />
                </div>
                <div className="min-w-[200px] flex-1">
                  <span className={labelClass}>
                    {t('settings.bearerKeyAllowedServers') || 'Allowed servers'}
                  </span>
                  <MultiSelect
                    options={availableServers}
                    selected={selectedServers}
                    onChange={setSelectedServers}
                    placeholder={t('settings.selectServers') || 'Select servers...'}
                    disabled={loading}
                  />
                </div>
              </>
            )}

            {/* Show both selectors for exclude mode */}
            {isAdmin && isSystemKey && isExcludeMode && (
              <>
                <div className="min-w-[200px] flex-1">
                  <span className={labelClass}>
                    {t('settings.bearerKeyExcludedGroups') || 'Excluded groups'}
                  </span>
                  <MultiSelect
                    options={availableGroups}
                    selected={excludedGroups}
                    onChange={setExcludedGroups}
                    placeholder={t('settings.selectGroups') || 'Select groups...'}
                    disabled={loading}
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
                    disabled={loading}
                  />
                </div>
              </>
            )}

            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setIsEditing(false)} className="hub-btn">
                {t('common.cancel') || 'Cancel'}
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={loading || saving}
                className="hub-btn primary"
              >
                {saving ? t('common.saving') || 'Saving...' : t('common.save') || 'Save'}
              </button>
            </div>
          </div>
        </div>
      </td>
    </tr>
  ) : null;

  return (
    <>
      <tr style={{ borderTop: '1px solid var(--hub-line)' }}>
        <td className={`${cellClass} font-medium`}>{keyData.name}</td>
        <td className={`${cellClass} hub-mono`} style={{ color: 'var(--hub-ink-3)' }}>
          {keyData.tokenPrefix ? `${keyData.tokenPrefix}...` : keyData.token}
        </td>
        <td className={cellClass}>
          <span className={`hub-status ${keyData.enabled ? 'ok' : 'muted'}`}>
            <span className="hub-dot" />
            {keyData.enabled ? t('common.active') : t('common.inactive')}
          </span>
        </td>
        <td className={cellClass} style={{ color: 'var(--hub-ink-3)' }}>
          {formatAccessTypeDisplay(keyData)}
        </td>
        <td className={`${cellClass} whitespace-nowrap text-right`}>
          <button
            type="button"
            onClick={() => setIsEditing((editing) => !editing)}
            disabled={loading || saving}
            aria-expanded={isEditing}
            aria-label={t(isEditing ? 'common.cancel' : 'common.edit')}
            className="hub-icon-btn sm"
            title={t(isEditing ? 'common.cancel' : 'common.edit')}
          >
            {isEditing ? <X className="h-4 w-4" /> : <Edit className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={() => onReset(keyData)}
            disabled={loading || saving || deleting}
            className="hub-icon-btn sm"
            title={t('settings.resetBearerKey')}
            aria-label={t('settings.resetBearerKey')}
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={loading || saving || deleting}
            className="hub-icon-btn sm"
            style={{ color: 'var(--hub-err)' }}
            title={t('common.delete') || 'Delete'}
            aria-label={t('common.delete') || 'Delete'}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </td>
      </tr>
      {editForm}
    </>
  );
};

export default BearerKeyRow;
