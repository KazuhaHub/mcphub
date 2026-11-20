import {
  adminHomePath,
  canUseAdminConsole,
  canViewSystemLogs,
  credentialsRedirect,
  getAdminNavKeys,
  getCredentialsNav,
  getNavArea,
  getPersonalNavKeys,
  homePath,
} from '../../frontend/src/utils/navigationPermissions';

describe('canViewSystemLogs', () => {
  it('allows admins to access the system logs menu', () => {
    expect(
      canViewSystemLogs({
        isAdmin: true,
      }),
    ).toBe(true);
  });

  it('hides the system logs menu from ordinary users', () => {
    expect(
      canViewSystemLogs({
        isAdmin: false,
      }),
    ).toBe(false);
  });

  it('hides the system logs menu when no user is signed in', () => {
    expect(canViewSystemLogs(null)).toBe(false);
  });
});

describe('credentials in the sidebar', () => {
  const ctx = (isAdmin: boolean, workspaceEnabled: boolean, resolved = true) => ({
    isAdmin,
    workspaceEnabled,
    resolved,
  });

  it('has no Credentials entry for ordinary users while Workspace Mode is on', () => {
    expect(getCredentialsNav(ctx(false, true))).toBeNull();
  });

  it('gives administrators a "user credentials" entry while Workspace Mode is on', () => {
    expect(getCredentialsNav(ctx(true, true))).toBe('admin');
  });

  it('keeps each person’s own Credentials page while Workspace Mode is off', () => {
    expect(getCredentialsNav(ctx(false, false))).toBe('own');
    expect(getCredentialsNav(ctx(true, false))).toBe('own');
  });

  it('shows ordinary users nothing until the setting is known', () => {
    expect(getCredentialsNav(ctx(false, false, false))).toBeNull();
  });
});

describe('credentialsRedirect', () => {
  const user = { isAdmin: false, workspaceEnabled: true };
  const admin = { isAdmin: true, workspaceEnabled: true };

  it('sends ordinary users to the workspace, opening the old deep-linked service', () => {
    expect(credentialsRedirect(user, {})).toBe('/workspace/services');
    expect(credentialsRedirect(user, { server: 'a b' })).toBe('/workspace/services/a%20b?tab=credentials');
    expect(credentialsRedirect(user, { user: 'alice' })).toBe('/workspace/services');
  });

  it('keeps the administrator page, except for old per-service links', () => {
    expect(credentialsRedirect(admin, {})).toBeNull();
    expect(credentialsRedirect(admin, { user: 'alice' })).toBeNull();
    expect(credentialsRedirect(admin, { user: 'alice', server: 'x' })).toBeNull();
    expect(credentialsRedirect(admin, { server: 'x' })).toBe('/workspace/services/x?tab=credentials');
  });

  it('never redirects while Workspace Mode is off', () => {
    expect(credentialsRedirect({ isAdmin: false, workspaceEnabled: false }, {})).toBeNull();
  });
});

describe('getNavArea', () => {
  const on = { isAdmin: true, workspaceEnabled: true };
  const off = { isAdmin: true, workspaceEnabled: false };

  it.each([
    '/dashboard',
    '/servers',
    '/groups',
    '/prompts',
    '/resources',
    '/market',
    '/market/foo',
    '/cloud',
    '/users',
    '/logs',
    '/activity',
    '/settings',
    '/credentials',
  ])('puts %s in the admin area while Workspace Mode is on', (path) => {
    expect(getNavArea(path, on)).toBe('admin');
  });

  it.each([
    '/workspace',
    '/workspace/services',
    '/workspace/services/foo',
    '/workspace/clients',
    '/workspace/activity',
    '/keys',
    '/account',
    '/services/foo',
    '/',
  ])('puts %s in the personal area, even for an administrator', (path) => {
    expect(getNavArea(path, on)).toBe('personal');
  });

  it('has no admin area while Workspace Mode is off', () => {
    for (const path of ['/dashboard', '/servers', '/settings', '/credentials', '/users']) {
      expect(getNavArea(path, off)).toBe('personal');
    }
  });
});

describe('the admin console', () => {
  it('is for administrators and people with a settings permission', () => {
    expect(canUseAdminConsole({ isAdmin: true })).toBe(true);
    expect(canUseAdminConsole({ permissions: ['settings:route_config'] })).toBe(true);
    expect(canUseAdminConsole({ isAdmin: false })).toBe(false);
    expect(canUseAdminConsole(null)).toBe(false);
  });

  it('starts at the dashboard for administrators and at Settings for the others', () => {
    expect(adminHomePath({ isAdmin: true })).toBe('/dashboard');
    expect(adminHomePath({ isAdmin: false, permissions: ['settings:x'] })).toBe('/settings');
  });

  it('sends everyone home to the workspace, or to the dashboard when the mode is off', () => {
    expect(homePath({ isAdmin: true, workspaceEnabled: true })).toBe('/workspace');
    expect(homePath({ isAdmin: false, workspaceEnabled: false })).toBe('/dashboard');
  });
});

describe('sidebar entries per area', () => {
  const admin = { isAdmin: true, permissions: [] as string[] };
  const caps = (user: { isAdmin?: boolean; permissions?: string[] } | null, more = {}) => ({
    user,
    canManageUsers: true,
    activityAvailable: true,
    ...more,
  });
  const on = (isAdmin: boolean, resolved = true) => ({ isAdmin, workspaceEnabled: true, resolved });
  const off = (isAdmin: boolean, resolved = true) => ({
    isAdmin,
    workspaceEnabled: false,
    resolved,
  });

  it('lists the workspace pages and API keys personally while the mode is on', () => {
    const expected = ['workspace', 'services', 'clients', 'activity', 'keys'];
    expect(getPersonalNavKeys(on(false))).toEqual(expected);
    expect(getPersonalNavKeys(on(true))).toEqual(expected);
  });

  it('lists the hub pages and each person’s own credentials personally while the mode is off', () => {
    const expected = [
      'dashboard',
      'servers',
      'groups',
      'prompts',
      'resources',
      'market',
      'credentials',
      'keys',
    ];
    expect(getPersonalNavKeys(off(false))).toEqual(expected);
    expect(getPersonalNavKeys(off(true))).toEqual(expected);
  });

  it('leaves an ordinary user only the API keys until the setting is known', () => {
    expect(getPersonalNavKeys({ ...off(false), resolved: false })).toEqual(['keys']);
    expect(getPersonalNavKeys({ ...on(true), resolved: false })).toContain('workspace');
  });

  it('gives administrators the whole console while the mode is on', () => {
    expect(getAdminNavKeys(on(true), caps(admin))).toEqual([
      'dashboard',
      'servers',
      'groups',
      'prompts',
      'resources',
      'market',
      'users',
      'activityLog',
      'logs',
      'userCredentials',
      'settings',
    ]);
  });

  it('leaves out users and the activity log when they are not available', () => {
    const keys = getAdminNavKeys(
      on(true),
      caps(admin, { canManageUsers: false, activityAvailable: false }),
    );
    expect(keys).not.toContain('users');
    expect(keys).not.toContain('activityLog');
    expect(keys).toContain('logs');
  });

  it('gives a settings-permission user just Settings', () => {
    const user = { isAdmin: false, permissions: ['settings:route_config'] };
    expect(getAdminNavKeys(on(false), caps(user))).toEqual(['settings']);
    expect(getAdminNavKeys(off(false), caps(user))).toEqual(['settings']);
  });

  it('gives nothing to an ordinary user', () => {
    expect(getAdminNavKeys(on(false), caps({ isAdmin: false }))).toEqual([]);
  });

  it('is only the System group while the mode is off', () => {
    expect(getAdminNavKeys(off(true), caps(admin))).toEqual([
      'users',
      'activityLog',
      'logs',
      'settings',
    ]);
  });
});
