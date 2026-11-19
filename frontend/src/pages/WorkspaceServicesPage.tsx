import React from 'react';
import { useTranslation } from 'react-i18next';
import WorkspaceServicesView from '@/components/workspace/WorkspaceServicesView';

const WorkspaceServicesPage: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="hub-h1">{t('workspacePage.services.tab')}</h1>
        <p className="hub-sub">{t('workspacePage.services.pageSubtitle')}</p>
      </div>
      <WorkspaceServicesView />
    </div>
  );
};

export default WorkspaceServicesPage;
