import { useBranding } from '@/contexts/BrandingContext';
import { BrandMark, useBrandLogo } from '@/components/BrandMark';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';
import {
  LayoutGrid,
  Server as ServerIcon,
  Users as UsersIcon,
  Store,
  Route as RouteIcon,
  Settings as SettingsIcon,
  FileText,
  MessageSquare,
  Activity,
  ScrollText,
  KeyRound,
  Briefcase,
  Plug,
  Key,
  Fingerprint,
  ShieldCheck,
  Lock,
  Layers,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useServerContext } from '@/contexts/ServerContext';
import { useGroupData } from '@/hooks/useGroupData';
import { useSettings } from '@/contexts/SettingsContext';
import {
  canViewSettings,
  canViewSystemLogs,
  getAccountNavKeys,
  getCredentialsNav,
  getManageNavKeys,
  getWorkspaceNavKeys,
  type NavKey,
} from '@/utils/navigationPermissions';
import { usePermissionCheck } from '../PermissionChecker';
import UserProfileMenu from '@/components/ui/UserProfileMenu';
import { useAppVersion } from '@/hooks/useAppVersion';
import { checkActivityAvailable } from '@/services/activityService';
import { useModalDrawer } from '@/hooks/useModalDrawer';

interface SidebarProps {
  collapsed: boolean;
  // Phones: render as an off-canvas drawer (with a backdrop) instead of an inline rail.
  drawer?: boolean;
  open?: boolean;
  onClose?: () => void;
}

interface MenuItem {
  path: string;
  label: string;
  icon: React.ReactNode;
  badge?: string | number;
  end?: boolean;
  // Overrides the link's own idea of being current (a service's page belongs to Workspace).
  match?: (pathname: string) => boolean;
}

const Sidebar: React.FC<SidebarProps> = ({ collapsed, drawer = false, open = false, onClose }) => {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const { dashboardTitle } = useBranding();
  const brandLogo = useBrandLogo();
  const { auth } = useAuth();
  const { allServers } = useServerContext();
  const { groups } = useGroupData();
  const { workspaceEnabled, workspaceResolved } = useSettings();
  const [activityAvailable, setActivityAvailable] = useState(false);

  const appVersion = useAppVersion();
  const asideRef = useRef<HTMLElement>(null);
  const drawerOpen = drawer && open;

  useModalDrawer({ open: drawerOpen, onClose: () => onClose?.(), containerRef: asideRef });

  useEffect(() => {
    checkActivityAvailable()
      .then(setActivityAvailable)
      .catch(() => setActivityAvailable(false));
  }, []);

  const userCanManageUsers = auth.user?.isAdmin && usePermissionCheck('x');

  const allItems: Record<NavKey, MenuItem> = {
    workspace: {
      path: '/workspace',
      label: t('workspacePage.home.nav'),
      icon: <Briefcase className="h-4 w-4" />,
      // Only the home page itself; the services, clients and activity pages have their own entries.
      end: true,
      match: (current) => current === '/workspace',
    },
    services: {
      path: '/workspace/services',
      label: t('workspacePage.services.tab'),
      icon: <Layers className="h-4 w-4" />,
      // A service's own page belongs here too.
      match: (current) =>
        current === '/workspace/services' || current.startsWith('/workspace/services/'),
    },
    clients: {
      path: '/workspace/clients',
      label: t('workspacePage.clients.tab'),
      icon: <Plug className="h-4 w-4" />,
    },
    activity: {
      path: '/workspace/activity',
      label: t('nav.myActivity'),
      icon: <Activity className="h-4 w-4" />,
    },
    dashboard: {
      path: '/',
      label: t('nav.dashboard'),
      icon: <LayoutGrid className="h-4 w-4" />,
      end: true,
    },
    servers: {
      path: '/servers',
      label: t('nav.servers'),
      icon: <ServerIcon className="h-4 w-4" />,
      badge: allServers.length || undefined,
    },
    groups: {
      path: '/groups',
      label: t('nav.groups'),
      icon: <RouteIcon className="h-4 w-4" />,
      badge: groups.length || undefined,
    },
    prompts: {
      path: '/prompts',
      label: t('nav.prompts'),
      icon: <MessageSquare className="h-4 w-4" />,
    },
    resources: {
      path: '/resources',
      label: t('nav.resources'),
      icon: <FileText className="h-4 w-4" />,
    },
    market: { path: '/market', label: t('nav.market'), icon: <Store className="h-4 w-4" /> },
    credentials: {
      path: '/credentials',
      label: t('credentials.title'),
      icon: <KeyRound className="h-4 w-4" />,
    },
    keys: { path: '/keys', label: t('nav.keys'), icon: <Key className="h-4 w-4" /> },
    passkeys: {
      path: '/passkeys',
      label: t('passkeys.title'),
      icon: <Fingerprint className="h-4 w-4" />,
    },
    oauthApps: {
      path: '/oauth-applications',
      label: t('oauthApprovals.title'),
      icon: <ShieldCheck className="h-4 w-4" />,
    },
    password: { path: '/password', label: t('nav.password'), icon: <Lock className="h-4 w-4" /> },
  };
  const navCtx = {
    isAdmin: Boolean(auth.user?.isAdmin),
    workspaceEnabled,
    resolved: workspaceResolved,
  };
  const workspaceItems: MenuItem[] = getWorkspaceNavKeys(navCtx).map((key) => allItems[key]);
  const manageItems: MenuItem[] = getManageNavKeys(navCtx).map((key) => allItems[key]);
  const accountItems: MenuItem[] = getAccountNavKeys(navCtx).map((key) => allItems[key]);

  const credentialsNav = getCredentialsNav(navCtx);
  const systemItems: MenuItem[] = [
    ...(userCanManageUsers
      ? [{ path: '/users', label: t('nav.users'), icon: <UsersIcon className="h-4 w-4" /> }]
      : []),
    ...(activityAvailable && auth.user?.isAdmin
      ? [{ path: '/activity', label: t('nav.activity'), icon: <Activity className="h-4 w-4" /> }]
      : []),
    ...(canViewSystemLogs(auth.user)
      ? [{ path: '/logs', label: t('nav.logs'), icon: <ScrollText className="h-4 w-4" /> }]
      : []),
    // Only the administrator's page for other people's credentials; one's own are in ACCOUNT.
    ...(credentialsNav === 'admin'
      ? [
          {
            path: '/credentials',
            label: t('credentials.adminTitle'),
            icon: <KeyRound className="h-4 w-4" />,
          },
        ]
      : []),
    ...(canViewSettings(auth.user)
      ? [
          {
            path: '/settings',
            label: t('nav.settings'),
            icon: <SettingsIcon className="h-4 w-4" />,
          },
        ]
      : []),
  ];

  const sections: Array<{ title: string; items: MenuItem[] }> = [
    { title: t('nav.workspace'), items: workspaceItems },
    { title: t('nav.manage'), items: manageItems },
    { title: t('nav.system'), items: systemItems },
    { title: t('nav.account'), items: accountItems },
  ].filter((section) => section.items.length > 0);

  const isCurrent = (item: MenuItem): boolean => {
    if (item.match) return item.match(pathname);
    if (pathname === item.path) return true;
    return !item.end && item.path !== '/' && pathname.startsWith(`${item.path}/`);
  };

  const renderItem = (item: MenuItem) => {
    const isActive = isCurrent(item);
    return (
      <Link
        key={item.path}
        to={item.path}
        aria-current={isActive ? 'page' : undefined}
        className={[
          // Icons sit 20px from the edge in both states, so collapsing never shifts them.
          'group relative flex h-8 max-md:h-10 items-center gap-2.5 rounded-md text-[14px] transition-colors duration-100',
          collapsed ? 'justify-center' : 'px-3',
          isActive
            ? 'bg-[var(--hub-surface)] font-medium text-[var(--hub-ink)] shadow-[var(--hub-shadow-resting)] ring-1 ring-inset ring-[var(--hub-line)]'
            : 'text-[var(--hub-ink-2)] hover:bg-[var(--hub-surface-hover)] hover:text-[var(--hub-ink)]',
        ].join(' ')}
      >
        <span
          className={
            isActive
              ? 'text-[var(--hub-ink)] flex-shrink-0'
              : 'text-[var(--hub-ink-3)] transition-colors duration-100 group-hover:text-[var(--hub-ink-2)] flex-shrink-0'
          }
        >
          {item.icon}
        </span>
        {!collapsed && (
          <>
            <span className="hub-sidebar-label truncate">{item.label}</span>
            {item.badge != null && (
              <span className="hub-sidebar-label ml-auto hub-mono hub-num text-[12px] font-normal text-[var(--hub-ink-3)]">
                {item.badge}
              </span>
            )}
          </>
        )}
      </Link>
    );
  };

  const asideClass = drawer
    ? // Off-canvas: slides in over the page. Visibility is set in the style below so the links
      // are out of the tab order while closed.
      'fixed inset-y-0 left-0 z-40 flex w-[232px] max-w-[85vw] flex-col overscroll-contain ' +
      'bg-[var(--hub-bg-2)] border-r border-[var(--hub-line)] ' +
      (open ? 'translate-x-0 shadow-[var(--hub-shadow-floating-md)]' : '-translate-x-full')
    : 'flex flex-col h-full relative shrink-0 ' +
      'transition-[width] duration-200 ease-[cubic-bezier(0.6,0,0.2,1)] ' +
      'bg-[var(--hub-bg-2)] border-r border-[var(--hub-line)] ' +
      (collapsed ? 'w-14' : 'w-[232px]');
  // Shown at once when opening so focus can move in; hidden only after the slide-out ends.
  const drawerStyle: React.CSSProperties | undefined = drawer
    ? {
        visibility: open ? 'visible' : 'hidden',
        transition: `transform 200ms cubic-bezier(0.6,0,0.2,1), visibility 0s linear ${open ? '0s' : '200ms'}`,
      }
    : undefined;

  return (
    <aside
      ref={asideRef}
      id="app-sidebar"
      className={asideClass}
      style={drawerStyle}
      {...(drawer
        ? {
            role: drawerOpen ? 'dialog' : undefined,
            'aria-modal': drawerOpen || undefined,
            'aria-label': dashboardTitle,
            // Any link inside closes the drawer, including a link to the current page.
            onClick: (event: React.MouseEvent) => {
              if ((event.target as HTMLElement).closest('a[href]')) onClose?.();
            },
          }
        : {})}
    >
      {/* Brand */}
      {/* Same height as the top bar, so their bottom borders form one line. */}
      <div
        className={
          'flex h-12 shrink-0 items-center gap-2.5 overflow-hidden border-b border-[var(--hub-line)] ' +
          (collapsed ? 'justify-center' : 'px-3.5')
        }
      >
        {!collapsed && brandLogo ? (
          <div className="hub-sidebar-label flex min-w-0 flex-col justify-center gap-0.5">
            <img
              src={brandLogo}
              alt={dashboardTitle}
              data-brand-logo
              className="block max-h-[26px] max-w-full self-start object-contain object-left"
              draggable={false}
            />
            {appVersion && (
              <span className="hub-mono truncate text-[10px] leading-none text-[var(--hub-ink-3)]">
                {appVersion === 'dev' ? appVersion : `v${appVersion}`}
              </span>
            )}
          </div>
        ) : (
          <>
            <BrandMark variant="gradient" />
            {!collapsed && (
              <div className="hub-sidebar-label flex min-w-0 flex-col leading-tight">
                <span className="truncate text-[14px] font-semibold tracking-tight text-[var(--hub-ink)]">
                  {dashboardTitle}
                </span>
                {appVersion && (
                  <span className="hub-mono truncate text-[11px] text-[var(--hub-ink-3)]">
                    {appVersion === 'dev' ? appVersion : `v${appVersion}`}
                  </span>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden py-2">
        {sections.map((section, index) => (
          <React.Fragment key={section.title}>
            {collapsed ? (
              index > 0 && <div className="mx-3 my-3 border-t border-[var(--hub-line)]" />
            ) : (
              <div
                className={
                  'hub-sect hub-sidebar-label px-5 pb-2 ' + (index === 0 ? 'pt-2' : 'pt-5')
                }
              >
                {section.title}
              </div>
            )}
            <nav
              aria-label={section.title}
              className={'flex flex-col gap-0.5 ' + (collapsed ? 'px-1.5' : 'px-2')}
            >
              {section.items.map(renderItem)}
            </nav>
          </React.Fragment>
        ))}
      </div>

      <div className="p-2.5 border-t border-[var(--hub-line)]">
        <UserProfileMenu collapsed={collapsed} version={appVersion} onOverlayOpen={onClose} />
      </div>
    </aside>
  );
};

export default Sidebar;
