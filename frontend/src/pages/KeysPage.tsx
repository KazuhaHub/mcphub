import React from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Info } from 'lucide-react';
import BearerKeysPanel from '@/components/apiKeys/BearerKeysPanel';
import { useAuth } from '@/contexts/AuthContext';

// The signed-in person's own API keys. Administrators manage every key under Settings.
const KeysPage: React.FC = () => {
  const { t } = useTranslation();
  const { auth } = useAuth();
  const isAdmin = Boolean(auth.user?.isAdmin);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <h1 className="hub-h1">{t('nav.keys')}</h1>
        <p className="hub-sub">{t('apiKeys.subtitle')}</p>
      </div>

      {isAdmin && (
        <div className="hub-callout info" data-testid="api-keys-admin-hint">
          <Info className="h-4 w-4" aria-hidden="true" />
          <span>
            {t('apiKeys.adminHint')}{' '}
            <Link to="/settings?section=authentication" className="font-medium underline">
              {t('settings.authenticationSection')}
            </Link>
          </span>
        </div>
      )}

      <div className="hub-card p-4">
        <BearerKeysPanel mode="personal" />
      </div>
    </div>
  );
};

export default KeysPage;
