import {
  ADMIN_ONLY_IN_WORKSPACE,
  canViewSettings,
  fallbackPath,
  getAccountNavKeys,
  getManageNavKeys,
  getWorkspaceNavKeys,
  isDashboardHome,
  isRouteAllowed,
} from '../../frontend/src/utils/navigationPermissions';

const adminOn = { isAdmin: true, workspaceEnabled: true };
const userOn = { isAdmin: false, workspaceEnabled: true };
const adminOff = { isAdmin: true, workspaceEnabled: false };
const userOff = { isAdmin: false, workspaceEnabled: false };

describe('workspace navigation entries', () => {
  const manage = ['dashboard', 'servers', 'groups', 'prompts', 'resources', 'market'];
  const workspace = ['workspace', 'clients', 'activity'];

  it('leaves the sidebar as it was when workspace mode is off', () => {
    for (const ctx of [adminOff, userOff]) {
      expect(getWorkspaceNavKeys(ctx)).toEqual([]);
      expect(getManageNavKeys(ctx)).toEqual(manage);
    }
  });

  it('shows ordinary users the workspace pages and nothing to manage when the mode is on', () => {
    expect(getWorkspaceNavKeys(userOn)).toEqual(workspace);
    expect(getManageNavKeys(userOn)).toEqual([]);
  });

  it('renders no entries for an ordinary user until the setting is resolved', () => {
    expect(getWorkspaceNavKeys({ ...userOn, resolved: false })).toEqual([]);
    expect(getManageNavKeys({ ...userOff, resolved: false })).toEqual([]);
    expect(getWorkspaceNavKeys({ ...adminOn, resolved: false })).toContain('workspace');
  });

  it('gives admins the same workspace pages and, besides them, the management pages', () => {
    expect(getWorkspaceNavKeys(adminOn)).toEqual(workspace);
    expect(getManageNavKeys(adminOn)).toEqual(manage);
  });
});

describe('the account section', () => {
  const account = ['keys', 'passkeys', 'oauthApps', 'password'];

  it('is the same for administrators and ordinary users in workspace mode', () => {
    expect(getAccountNavKeys(adminOn)).toEqual(account);
    expect(getAccountNavKeys(userOn)).toEqual(account);
  });

  it('adds each person\u2019s own credentials page while workspace mode is off', () => {
    expect(getAccountNavKeys(userOff)).toEqual(['credentials', ...account]);
    expect(getAccountNavKeys(adminOff)).toEqual(['credentials', ...account]);
  });

  it('keeps the old credentials page out of it until the setting is known', () => {
    expect(getAccountNavKeys({ ...userOff, resolved: false })).toEqual(account);
  });
});

describe('the system settings page', () => {
  it('is for administrators and people with a settings permission', () => {
    expect(canViewSettings({ isAdmin: true })).toBe(true);
    expect(canViewSettings({ isAdmin: false, permissions: ['*'] })).toBe(true);
    expect(canViewSettings({ permissions: ['settings:route_config'] })).toBe(true);
  });

  it('is not for everyone else, who have the personal pages instead', () => {
    expect(canViewSettings({ isAdmin: false })).toBe(false);
    expect(canViewSettings({ permissions: ['x'] })).toBe(false);
    expect(canViewSettings(null)).toBe(false);
  });
});

describe('workspace route access', () => {
  const adminPages = [
    '/',
    '/servers',
    '/groups',
    '/prompts',
    '/resources',
    '/market',
    '/market/foo',
    '/cloud',
    '/cloud/foo',
    '/users',
    '/logs',
    '/activity',
  ];
  const personalPages = [
    '/workspace',
    '/workspace/clients',
    '/workspace/activity',
    '/keys',
    '/password',
    '/passkeys',
    '/oauth-applications',
    '/workspace/services/ubc-personal',
    '/credentials',
    '/settings',
  ];

  it.each(adminPages)('redirects ordinary users away from %s when the mode is on', (path) => {
    expect(isRouteAllowed(path, userOn)).toBe(false);
  });

  it.each([...adminPages, ...personalPages])('lets admins open %s when the mode is on', (path) => {
    expect(isRouteAllowed(path, adminOn)).toBe(true);
  });

  it.each(personalPages)('lets ordinary users open %s when the mode is on', (path) => {
    expect(isRouteAllowed(path, userOn)).toBe(true);
  });

  it.each([...adminPages, '/credentials', '/settings'])(
    'allows %s for everyone when the mode is off',
    (path) => {
      expect(isRouteAllowed(path, adminOff)).toBe(true);
      expect(isRouteAllowed(path, userOff)).toBe(true);
    },
  );

  it('hides the workspace pages when the mode is off', () => {
    expect(isRouteAllowed('/workspace', adminOff)).toBe(false);
    expect(isRouteAllowed('/workspace/clients', userOff)).toBe(false);
  });

  it('sends ordinary users to the workspace and everyone else to the dashboard', () => {
    expect(fallbackPath(userOn)).toBe('/workspace');
    expect(fallbackPath(adminOn)).toBe('/');
    expect(fallbackPath(userOff)).toBe('/');
    expect(isDashboardHome(userOn)).toBe(false);
    expect(isDashboardHome(adminOn)).toBe(true);
    expect(isDashboardHome(userOff)).toBe(true);
  });
});

describe('admin-only route list', () => {
  it('covers every admin-style page of the app', () => {
    expect(ADMIN_ONLY_IN_WORKSPACE).toEqual(
      expect.arrayContaining(['/users', '/logs', '/activity', '/cloud', '/market', '/servers']),
    );
  });
});
