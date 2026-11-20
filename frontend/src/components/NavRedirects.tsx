import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useSettings } from '@/contexts/SettingsContext';
import { adminHomePath, canUseAdminConsole, homePath } from '@/utils/navigationPermissions';

/** `/` leads to the workspace while Workspace Mode is on (admins too) and to the dashboard otherwise. */
export const HomeRedirect: React.FC = () => {
  const { auth } = useAuth();
  const { workspaceEnabled } = useSettings();
  const ctx = { isAdmin: Boolean(auth.user?.isAdmin), workspaceEnabled };
  return <Navigate to={homePath(ctx)} replace />;
};

/** A bookmarkable `/admin`: the Admin console's first page, or home for people without one. */
export const AdminRedirect: React.FC = () => {
  const { auth } = useAuth();
  const { workspaceEnabled } = useSettings();
  const ctx = { isAdmin: Boolean(auth.user?.isAdmin), workspaceEnabled };
  const target =
    workspaceEnabled && canUseAdminConsole(auth.user) ? adminHomePath(auth.user) : homePath(ctx);
  return <Navigate to={target} replace />;
};

/** An old page address that now lives on another page; the hash is kept. */
export const LegacyRedirect: React.FC<{ to: string }> = ({ to }) => {
  const { hash } = useLocation();
  return <Navigate to={`${to}${hash}`} replace />;
};
