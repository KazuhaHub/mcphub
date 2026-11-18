import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useBranding } from '@/contexts/BrandingContext';
import { useToast } from '@/contexts/ToastContext';
import { apiPut } from '@/utils/fetchInterceptor';
import {
  BRANDING_ACCEPT,
  prepareBrandingImage,
  type BrandingSlot,
} from '@/utils/brandingImage';

const SLOTS: { slot: BrandingSlot; maxSide: number; previews: ('light' | 'dark')[] }[] = [
  { slot: 'icon', maxSide: 256, previews: ['light'] },
  { slot: 'logoLight', maxSide: 1024, previews: ['light', 'dark'] },
  { slot: 'logoDark', maxSide: 1024, previews: ['dark', 'light'] },
];

const previewBackground = { light: '#ffffff', dark: '#16181d' } as const;

interface SlotProps {
  slot: BrandingSlot;
  maxSide: number;
  backgrounds: ('light' | 'dark')[];
}

const BrandingSlotEditor: React.FC<SlotProps> = ({ slot, maxSide, backgrounds }) => {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { branding, setBranding } = useBranding();
  const stored = branding[slot];
  const [pending, setPending] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const shown = pending || stored;
  const wide = slot !== 'icon';

  useEffect(() => setPending(''), [stored]);

  const choose = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const result = await prepareBrandingImage(file, maxSide);
    if (!result.ok) {
      showToast(t(`settings.branding.error.${result.error}`), 'error');
      return;
    }
    setPending(result.dataUrl);
  };

  const save = async (value: string, successKey: string) => {
    setBusy(true);
    try {
      const result = await apiPut('/system-config', { dashboardBranding: { [slot]: value } });
      if (!result.success) throw new Error(result.message || result.error);
      setBranding({ [slot]: value });
      setPending('');
      showToast(t(successKey));
    } catch {
      showToast(t('settings.branding.saveFailed'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const id = `branding-${slot}`;
  return (
    <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-md" data-branding-slot={slot}>
      <label htmlFor={id} className="block font-medium text-gray-700">
        {t(`settings.branding.${slot}.label`)}
      </label>
      <p id={`${id}-hint`} className="text-sm text-gray-500 mb-2">
        {t(`settings.branding.${slot}.hint`)}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        {backgrounds.map((background) => (
          <div
            key={background}
            className="flex shrink-0 items-center justify-center rounded-md border border-gray-300 overflow-hidden"
            data-preview-background={background}
            style={{
              background: previewBackground[background],
              width: wide ? 160 : 64,
              height: 64,
            }}
          >
            {shown ? (
              <img
                src={shown}
                alt={background === backgrounds[0] ? t(`settings.branding.${slot}.label`) : ''}
                data-branding-preview={slot}
                className="max-h-full max-w-full object-contain p-1.5"
              />
            ) : (
              <span className="text-xs text-gray-400 px-2 text-center">
                {t('settings.branding.notSet')}
              </span>
            )}
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={input}
            id={id}
            type="file"
            accept={BRANDING_ACCEPT}
            aria-describedby={`${id}-hint`}
            onChange={choose}
            disabled={busy}
            className="sr-only"
          />
          <button
            type="button"
            className="hub-btn"
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            {stored || pending ? t('settings.branding.replace') : t('settings.branding.upload')}
          </button>
          {pending && (
            <>
              <button
                type="button"
                className="hub-btn primary"
                disabled={busy}
                onClick={() => save(pending, 'settings.branding.saved')}
              >
                {t('common.save')}
              </button>
              <button type="button" className="hub-btn" disabled={busy} onClick={() => setPending('')}>
                {t('common.cancel')}
              </button>
            </>
          )}
          {stored && !pending && (
            <button
              type="button"
              className="hub-btn danger"
              disabled={busy}
              onClick={() => save('', 'settings.branding.removed')}
            >
              {t('settings.branding.remove')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

const BrandingSettings: React.FC = () => {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { dashboardName, setDashboardName } = useBranding();
  const [tempName, setTempName] = useState(dashboardName);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setTempName(dashboardName);
  }, [dashboardName]);

  const saveName = async () => {
    setSaving(true);
    try {
      const name = tempName.trim();
      const result = await apiPut('/system-config', { dashboardName: name });
      if (!result.success) throw new Error(result.message || result.error);
      setDashboardName(name);
      setTempName(name);
      showToast(t('settings.systemConfigUpdated'));
    } catch {
      showToast(t('settings.dashboardNameSaveFailed'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-labelledby="branding-heading" className="space-y-4">
      <div>
        <h3 id="branding-heading" className="font-semibold text-gray-800">
          {t('settings.branding.title')}
        </h3>
        <p className="text-sm text-gray-500">{t('settings.branding.description')}</p>
      </div>
      <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-md">
        <label htmlFor="dashboard-name" className="block font-medium text-gray-700">
          {t('settings.dashboardName')}
        </label>
        <p id="dashboard-name-description" className="text-sm text-gray-500 mb-2">
          {t('settings.dashboardNameDescription')}
        </p>
        <div className="flex items-center gap-3">
          <input
            id="dashboard-name"
            aria-describedby="dashboard-name-description"
            value={tempName}
            onChange={(e) => setTempName(e.target.value)}
            maxLength={100}
            placeholder={t('app.title')}
            disabled={saving}
            className="flex-1 min-w-0 py-2 px-3 border border-gray-300 rounded-md form-input"
          />
          <button onClick={saveName} disabled={saving} className="hub-btn primary">
            {t('common.save')}
          </button>
        </div>
      </div>
      {SLOTS.map(({ slot, maxSide, previews }) => (
        <BrandingSlotEditor key={slot} slot={slot} maxSide={maxSide} backgrounds={previews} />
      ))}
    </section>
  );
};

export default BrandingSettings;
