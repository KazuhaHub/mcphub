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
// Every page in App.tsx except the workspace, credentials and settings pages.
export const ADMIN_ONLY_IN_WORKSPACE = [
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

const matchesPrefix = (pathname: string, prefix: string): boolean =>
  pathname === prefix || pathname.startsWith(`${prefix}/`);

/** Where `/` leads: ordinary users land on the workspace page when the mode is on. */
export const isDashboardHome = (ctx: NavContext): boolean =>
  ctx.isAdmin || !ctx.workspaceEnabled;

/** Whether the path may be shown to the user. Workspace Mode off leaves every route as before. */
export const isRouteAllowed = (pathname: string, ctx: NavContext): boolean => {
  if (pathname === '/workspace' || pathname.startsWith('/workspace/')) return ctx.workspaceEnabled;
  if (!ctx.workspaceEnabled || ctx.isAdmin) return true;
  if (pathname === '/') return false;
  return !ADMIN_ONLY_IN_WORKSPACE.some((prefix) => matchesPrefix(pathname, prefix));
};

/** Where a user is sent when a path is not allowed for them. */
export const fallbackPath = (ctx: NavContext): string =>
  ctx.workspaceEnabled && !ctx.isAdmin ? '/workspace' : '/';

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
  | 'passkeys'
  | 'oauthApps'
  | 'password';

const MANAGE_GROUP_ITEMS: readonly NavKey[] = [
  'dashboard',
  'servers',
  'groups',
  'prompts',
  'resources',
  'market',
];

/**
 * Entries of the sidebar's WORKSPACE section: what a person does with their own endpoint. It
 * exists only while Workspace Mode is on, and is the same for everyone.
 */
export const getWorkspaceNavKeys = (ctx: NavContext): NavKey[] => {
  if (ctx.resolved === false && !ctx.isAdmin) return [];
  return ctx.workspaceEnabled ? ['workspace', 'services', 'clients', 'activity'] : [];
};

/**
 * Entries of the section for managing the hub itself: administrators always, everyone while
 * Workspace Mode is off. An ordinary user gets none until the setting is known, so admin pages
 * never flash.
 */
export const getManageNavKeys = (ctx: NavContext): NavKey[] => {
  if (ctx.resolved === false && !ctx.isAdmin) return [];
  return ctx.isAdmin || !ctx.workspaceEnabled ? [...MANAGE_GROUP_ITEMS] : [];
};

/**
 * Entries of the ACCOUNT section: what belongs to the signed-in person, the same for everyone.
 * With Workspace Mode off the old per-person Credentials page sits here too.
 */
export const getAccountNavKeys = (ctx: NavContext): NavKey[] => [
  ...(getCredentialsNav(ctx) === 'own' ? (['credentials'] as const) : []),
  'keys',
  'passkeys',
  'oauthApps',
  'password',
];

/**
 * Whether the system Settings page has anything for this person: administrators, and people
 * given at least one settings permission. Personal items (keys, password) are separate pages.
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
