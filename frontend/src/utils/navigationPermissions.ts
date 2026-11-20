import { workspaceCredentialsPath } from './workspace';

type UserLike = {
  isAdmin?: boolean;
} | null | undefined;

export const canViewSystemLogs = (user: UserLike): boolean => Boolean(user?.isAdmin);

export type NavContext = {
  isAdmin: boolean;
  workspaceEnabled: boolean;
  // False until the Workspace Mode setting has been read; defaults to true.
  resolved?: boolean;
};

// Pages that stay admin-only for ordinary users once Workspace Mode is on.
// Every page in App.tsx except the workspace, account, keys, credentials and settings pages.
export const ADMIN_ONLY_IN_WORKSPACE = [
  '/dashboard',
  '/servers',
  '/groups',
  '/prompts',
  '/resources',
  '/market',
  '/cloud',
  '/users',
  '/logs',
  '/activity',
];

// Paths that belong to the Admin console while Workspace Mode is on. `/credentials` joins them
// only then (see getNavArea). Everything else, including pages shared by both areas, is personal.
export const ADMIN_AREA_PREFIXES = [...ADMIN_ONLY_IN_WORKSPACE, '/settings'];

const matchesPrefix = (pathname: string, prefix: string): boolean =>
  pathname === prefix || pathname.startsWith(`${prefix}/`);

export type NavArea = 'personal' | 'admin';

/**
 * The area a page belongs to, which decides the sidebar. With Workspace Mode off there is no
 * split. Pages that are neither (the account page, a service's link page) show the personal one.
 */
export const getNavArea = (pathname: string, ctx: NavContext): NavArea => {
  if (!ctx.workspaceEnabled) return 'personal';
  const inAdminArea =
    ADMIN_AREA_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix)) ||
    matchesPrefix(pathname, '/credentials');
  return inAdminArea ? 'admin' : 'personal';
};

type PermissionUser = { isAdmin?: boolean; permissions?: string[] } | null | undefined;

/**
 * Whether the person has an Admin console to go to: administrators and people given at least
 * one settings permission.
 */
export const canUseAdminConsole = (user: PermissionUser): boolean =>
  Boolean(user?.isAdmin) || canViewSettings(user);

/** Where `/` leads, and where a page that is not allowed sends the person. */
export const homePath = (ctx: NavContext): string =>
  ctx.workspaceEnabled ? '/workspace' : '/dashboard';

/** The first page of the Admin console for this person. */
export const adminHomePath = (user: PermissionUser): string =>
  user?.isAdmin ? '/dashboard' : '/settings';

/** Whether the path may be shown to the user. Workspace Mode off leaves every route as before. */
export const isRouteAllowed = (pathname: string, ctx: NavContext): boolean => {
  if (pathname === '/workspace' || pathname.startsWith('/workspace/')) return ctx.workspaceEnabled;
  // `/` only redirects, and the account page is everyone's own.
  if (pathname === '/' || matchesPrefix(pathname, '/account')) return true;
  if (!ctx.workspaceEnabled || ctx.isAdmin) return true;
  return !ADMIN_ONLY_IN_WORKSPACE.some((prefix) => matchesPrefix(pathname, prefix));
};

/** Where a user is sent when a path is not allowed for them. */
export const fallbackPath = (ctx: NavContext): string => homePath(ctx);

export type NavKey =
  | 'workspace'
  | 'services'
  | 'clients'
  | 'activity'
  | 'dashboard'
  | 'servers'
  | 'groups'
  | 'prompts'
  | 'resources'
  | 'market'
  | 'credentials'
  | 'keys'
  | 'users'
  | 'activityLog'
  | 'logs'
  | 'userCredentials'
  | 'settings';

const MANAGE_ITEMS: readonly NavKey[] = [
  'dashboard',
  'servers',
  'groups',
  'prompts',
  'resources',
  'market',
];

/**
 * Entries of the personal sidebar. With Workspace Mode on that is what a person does with their
 * own endpoint, the same for everyone. With it off there is one sidebar for everybody, so the
 * hub's own pages and each person's credentials are listed too; an ordinary user gets only the
 * API keys until the setting is known, so admin pages never flash.
 */
export const getPersonalNavKeys = (ctx: NavContext): NavKey[] => {
  if (ctx.resolved === false && !ctx.isAdmin) return ['keys'];
  if (ctx.workspaceEnabled) return ['workspace', 'services', 'clients', 'activity', 'keys'];
  return [...MANAGE_ITEMS, 'credentials', 'keys'];
};

export type AdminNavCaps = {
  user: PermissionUser;
  // Administrators who also hold the user-management permission.
  canManageUsers: boolean;
  activityAvailable: boolean;
};

/**
 * Entries of the Admin console. With Workspace Mode off they are the "System" group of the single
 * sidebar, which leaves out the management pages that are already in the personal list.
 */
export const getAdminNavKeys = (ctx: NavContext, caps: AdminNavCaps): NavKey[] => {
  const isAdmin = Boolean(caps.user?.isAdmin);
  const keys: NavKey[] = [];
  if (ctx.workspaceEnabled && isAdmin) keys.push(...MANAGE_ITEMS);
  if (isAdmin && caps.canManageUsers) keys.push('users');
  if (isAdmin && caps.activityAvailable) keys.push('activityLog');
  if (canViewSystemLogs(caps.user)) keys.push('logs');
  if (getCredentialsNav(ctx) === 'admin') keys.push('userCredentials');
  if (canViewSettings(caps.user)) keys.push('settings');
  return keys;
};

/**
 * Whether the system Settings page has anything for this person: administrators, and people
 * given at least one settings permission. Personal items (API keys, account settings) are separate pages.
 */
export const canViewSettings = (
  user: { isAdmin?: boolean; permissions?: string[] } | null | undefined,
): boolean =>
  Boolean(user?.isAdmin) ||
  Boolean(user?.permissions?.some((entry) => entry === '*' || entry.startsWith('settings:')));

/** Title key of the sidebar entry for credentials, or null when there is none. */
export type CredentialsNav = 'own' | 'admin' | null;

/**
 * With Workspace Mode on, people set their own credentials on the workspace services list, so
 * ordinary users have no credentials page and administrators keep one for managing other
 * users' credentials. With the mode off the page stays what it was: each person's own list.
 */
export const getCredentialsNav = (ctx: NavContext): CredentialsNav => {
  if (ctx.resolved === false && !ctx.isAdmin) return null;
  if (!ctx.workspaceEnabled) return 'own';
  return ctx.isAdmin ? 'admin' : null;
};

/**
 * Where an old `/credentials` link goes. Null means the page itself is shown. `server` is the
 * old deep link parameter; it now opens that service's credential panel on the workspace.
 */
export const credentialsRedirect = (
  ctx: NavContext,
  params: { user?: string | null; server?: string | null },
): string | null => {
  if (!ctx.workspaceEnabled) return null;
  if (ctx.isAdmin && params.user) return null;
  if (ctx.isAdmin && !params.server) return null;
  return params.server ? workspaceCredentialsPath(params.server) : '/workspace/services';
};
