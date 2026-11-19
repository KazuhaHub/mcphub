import React from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useSearchParams } from 'react-router-dom';
import ConnectCard from '@/components/connect/ConnectCard';
import WorkspaceHome from '@/components/workspace/WorkspaceHome';
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
  // The services list, connected clients and activity used to be tabs here; they are pages of
  // their own.
  const legacyTab = search.get('tab');
  if (legacyTab === 'clients' || legacyTab === 'activity' || legacyTab === 'services') {
    return <Navigate to={`/workspace/${legacyTab}`} replace />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="hub-h1">{t('workspacePage.home.title')}</h1>
        <p className="hub-sub">{t('workspacePage.home.subtitle')}</p>
      </div>

      <ConnectCard />

      <WorkspaceHome />
    </div>
  );
};

export default WorkspacePage;
