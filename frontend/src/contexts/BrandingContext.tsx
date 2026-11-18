import React, { createContext, useContext, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getPublicConfig } from '../services/configService';
import { EMPTY_BRANDING, type BrandingImages } from '../utils/brandingImage';

interface BrandingContextValue {
  dashboardName: string;
  dashboardTitle: string;
  setDashboardName: (name: string) => void;
  branding: BrandingImages;
  setBranding: (images: Partial<BrandingImages>) => void;
}

const BrandingContext = createContext<BrandingContextValue | null>(null);

export const BrandingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { t } = useTranslation();
  const [dashboardName, setDashboardName] = useState('');
  const [branding, setBrandingState] = useState<BrandingImages>(EMPTY_BRANDING);
  const dashboardTitle = dashboardName || t('app.title');

  const setBranding = (images: Partial<BrandingImages>) =>
    setBrandingState((current) => ({ ...current, ...images }));

  useEffect(() => {
    let active = true;
    void getPublicConfig().then((config) => {
      if (!active) return;
      setDashboardName(config.dashboardName?.trim() || '');
      setBrandingState({ ...EMPTY_BRANDING, ...config.dashboardBranding });
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    document.title = dashboardName || 'MCPHub Dashboard';
  }, [dashboardName]);

  // The icon becomes the favicon; clearing it restores the default one.
  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
    if (!link) return;
    if (link.dataset.defaultHref === undefined) {
      link.dataset.defaultHref = link.getAttribute('href') ?? '';
      link.dataset.defaultType = link.getAttribute('type') ?? '';
    }
    if (branding.icon) {
      link.setAttribute('href', branding.icon);
      link.setAttribute('type', branding.icon.slice(5, branding.icon.indexOf(';')));
    } else {
      link.setAttribute('href', link.dataset.defaultHref);
      if (link.dataset.defaultType) link.setAttribute('type', link.dataset.defaultType);
      else link.removeAttribute('type');
    }
  }, [branding.icon]);

  return (
    <BrandingContext.Provider
      value={{ dashboardName, dashboardTitle, setDashboardName, branding, setBranding }}
    >
      {children}
    </BrandingContext.Provider>
  );
};

export const useBranding = () => {
  const context = useContext(BrandingContext);
  if (!context) throw new Error('useBranding must be used within a BrandingProvider');
  return context;
};
