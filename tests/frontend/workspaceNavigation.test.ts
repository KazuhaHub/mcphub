import fs from 'fs';
import path from 'path';
import {
  ADMIN_ONLY_IN_WORKSPACE,
  canViewSettings,
  fallbackPath,
  getNavArea,
  isRouteAllowed,
} from '../../frontend/src/utils/navigationPermissions';

const adminOn = { isAdmin: true, workspaceEnabled: true };
const userOn = { isAdmin: false, workspaceEnabled: true };
const adminOff = { isAdmin: true, workspaceEnabled: false };
const userOff = { isAdmin: false, workspaceEnabled: false };

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
    '/dashboard',
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
    '/',
    '/keys',
    '/account',
    '/account/anything',
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

  it('sends everyone to the workspace while the mode is on, and to the dashboard when it is off', () => {
    expect(fallbackPath(userOn)).toBe('/workspace');
    expect(fallbackPath(adminOn)).toBe('/workspace');
    expect(fallbackPath(userOff)).toBe('/dashboard');
    expect(fallbackPath(adminOff)).toBe('/dashboard');
  });
});

describe('admin-only route list', () => {
  it('covers every admin-style page of the app', () => {
    expect(ADMIN_ONLY_IN_WORKSPACE).toEqual(
      expect.arrayContaining([
        '/dashboard',
        '/users',
        '/logs',
        '/activity',
        '/cloud',
        '/market',
        '/servers',
      ]),
    );
  });
});

describe('every page route of the app', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'frontend', 'src', 'App.tsx'), 'utf8');
  const layout = source.slice(source.indexOf('<MainLayout />'), source.indexOf('path="*"'));
  const routes = [...layout.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]);
  // Pages that belong to the admin console while Workspace Mode is on.
  const admin = [
    '/dashboard',
    '/servers',
    '/groups',
    '/prompts',
    '/resources',
    '/users',
    '/market',
    '/market/:serverName',
    '/cloud',
    '/cloud/:serverName',
    '/logs',
    '/activity',
    '/settings',
    '/credentials',
  ];
  // The personal area, and pages that show it because they belong to neither area.
  const personal = [
    '/workspace',
    '/workspace/services',
    '/workspace/services/:name',
    '/workspace/clients',
    '/workspace/activity',
    '/keys',
    '/account',
    '/services/:serverName',
  ];
  // Redirects: they never render a page of their own.
  const redirects = ['/', '/admin', '/password', '/passkeys', '/oauth-applications'];

  it('is assigned an area, or is a redirect', () => {
    const known = [...admin, ...personal, ...redirects];
    expect(routes.filter((route) => !known.includes(route))).toEqual([]);
    expect(known.filter((route) => !routes.includes(route))).toEqual([]);
  });

  it('gets the area it was assigned', () => {
    const ctx = { isAdmin: true, workspaceEnabled: true };
    const concrete = (route: string) => route.replace(/:[A-Za-z]+/g, 'x');
    for (const route of admin) expect(getNavArea(concrete(route), ctx)).toBe('admin');
    for (const route of personal) expect(getNavArea(concrete(route), ctx)).toBe('personal');
  });
});
