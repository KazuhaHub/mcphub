import React from 'react';
import { useTranslation } from 'react-i18next';
import type { BearerKey } from '@/types';
import BearerKeyRow, { type BearerKeyEditPayload, type SelectOption } from './BearerKeyRow';

interface BearerKeyTableProps {
  keys: BearerKey[];
  loading: boolean;
  availableServers: SelectOption[];
  // Options for system-level keys (group names) and for personal keys (group IDs).
  systemGroupOptions: SelectOption[];
  personalGroupOptions: SelectOption[];
  isAdmin: boolean;
  onSave: (id: string, payload: BearerKeyEditPayload) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onReset: (key: BearerKey) => void;
}

const BearerKeyTable: React.FC<BearerKeyTableProps> = ({
  keys,
  loading,
  availableServers,
  systemGroupOptions,
  personalGroupOptions,
  isAdmin,
  onSave,
  onDelete,
  onReset,
}) => {
  const { t } = useTranslation();
  return (
    <div
      className="hub-scroll-x overflow-x-auto"
      style={{ border: '1px solid var(--hub-line)', borderRadius: 'var(--hub-radius)' }}
    >
      <table className="w-full text-left text-[13px]">
        <thead>
          <tr style={{ color: 'var(--hub-ink-3)' }}>
            {(
              [
                ['settings.bearerKeyName', 'Name'],
                ['settings.bearerKeyToken', 'Token'],
                ['settings.bearerKeyEnabled', 'Status'],
                ['settings.bearerKeyAccessType', 'Access Scope'],
              ] as const
            ).map(([key, fallback]) => (
              <th key={key} scope="col" className="px-4 py-2 font-medium">
                {t(key) || fallback}
              </th>
            ))}
            <th scope="col" className="px-4 py-2">
              <span className="sr-only">{t('common.actions')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {keys.map((key) => (
            <BearerKeyRow
              key={key.id}
              keyData={key}
              loading={loading}
              availableServers={availableServers}
              availableGroups={
                (key.kind ?? 'system') === 'system' ? systemGroupOptions : personalGroupOptions
              }
              isAdmin={isAdmin}
              onSave={onSave}
              onDelete={onDelete}
              onReset={onReset}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default BearerKeyTable;
