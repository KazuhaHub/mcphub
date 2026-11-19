import React from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useSearchParams } from 'react-router-dom';
import ConnectCard from '@/components/connect/ConnectCard';
import WorkspaceServicesView from '@/components/workspace/WorkspaceServicesView';
import { workspaceServicePath } from '@/utils/workspace';

const WorkspacePage: React.FC = () => {
  const { t } = useTranslation();
  const [search] = useSearchParams();
  // Old links opened a drawer on this page; each service has its own page now.
  const legacyCredentials = search.get('credentials');
  const legacyService = search.get('service');
  if (legacyCredentials) {
    return <Navigate to={workspaceServicePath(legacyCredentials, 'credentials')} replace />;
  }
  if (legacyService) return <Navigate to={workspaceServicePath(legacyService)} replace />;
  // Connected clients and activity used to be tabs here; they are pages of their own.
  const legacyTab = search.get('tab');
  if (legacyTab === 'clients' || legacyTab === 'activity') {
    return <Navigate to={`/workspace/${legacyTab}`} replace />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="hub-h1">{t('workspacePage.title')}</h1>
        <p className="hub-sub">{t('workspacePage.subtitle')}</p>
      </div>

      <ConnectCard />

      <WorkspaceServicesView />
    </div>
  );
};

export default WorkspacePage;
