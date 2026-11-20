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

/** An old page address that now lives on another page; the query and hash are kept. */
export const LegacyRedirect: React.FC<{ to: string }> = ({ to }) => {
  const { search, hash } = useLocation();
  // The incoming query is kept; the target's own parameters (the tab) win over it.
  const [path, targetQuery = ''] = to.split('?');
  const params = new URLSearchParams(search);
  new URLSearchParams(targetQuery).forEach((value, key) => params.set(key, value));
  const query = params.toString();
  return <Navigate to={`${path}${query ? `?${query}` : ''}${hash}`} replace />;
};
