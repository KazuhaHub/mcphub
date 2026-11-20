import fs from 'fs';
import path from 'path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import RouteAccessGuard from '../../frontend/src/components/RouteAccessGuard';
import Sidebar from '../../frontend/src/components/layout/Sidebar';

let mockAuthUser: { username: string; isAdmin: boolean; permissions?: string[] } = {
  username: 'alice',
  isAdmin: false,
};
let mockSettings = {
  workspaceEnabled: true,
  workspaceResolved: true,
  workspaceLoadFailed: false,
  fetchSettings: jest.fn(),
};

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ auth: { user: mockAuthUser, loading: false, isAuthenticated: true } }),
}));
jest.mock('@/contexts/SettingsContext', () => ({ useSettings: () => mockSettings }));
jest.mock('@/contexts/BrandingContext', () => ({
  useBranding: () => ({
    dashboardName: '',
    dashboardTitle: 'app.title',
    setDashboardName: jest.fn(),
    branding: { icon: '', logoLight: '', logoDark: '' },
    setBranding: jest.fn(),
  }),
}));
jest.mock('@/contexts/ThemeContext', () => ({ useTheme: () => ({ resolvedTheme: 'light' }) }));
jest.mock('@/contexts/ServerContext', () => ({ useServerContext: () => ({ allServers: [] }) }));
jest.mock('@/hooks/useGroupData', () => ({ useGroupData: () => ({ groups: [] }) }));
jest.mock('@/services/activityService', () => ({
  checkActivityAvailable: jest.fn(() => Promise.resolve(false)),
}));
jest.mock('@/hooks/useAppVersion', () => ({ useAppVersion: () => 'test' }));
jest.mock('@/components/ui/UserProfileMenu', () => ({ __esModule: true, default: () => null }));
jest.mock('../../frontend/src/components/PermissionChecker', () => ({
  usePermissionCheck: () => true,
}));

const renderSidebar = (pathname = '/') =>
  renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: [pathname] },
      createElement(Sidebar, { collapsed: false }),
    ),
  );
const link = (html: string, href: string) =>
  new RegExp(`<a [^>]*href="${href}"[^>]*>`).exec(html)?.[0] ?? '';

const renderGuard = (pathname: string) =>
  renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: [pathname] },
      createElement(
        Routes,
        null,
        createElement(
          Route,
          { element: createElement(RouteAccessGuard) },
          createElement(Route, { path: '/', element: 'HOME-REDIRECT' }),
          createElement(Route, { path: '/dashboard', element: 'DASHBOARD-PAGE' }),
          createElement(Route, { path: '/users', element: 'USERS-PAGE' }),
          createElement(Route, { path: '/workspace', element: 'WORKSPACE-PAGE' }),
        ),
      ),
    ),
  );

const setSettings = (user: typeof mockAuthUser, settings: Partial<typeof mockSettings>) => {
  mockAuthUser = user;
  mockSettings = { ...mockSettings, ...settings };
};
const alice = { username: 'alice', isAdmin: false };
const admin = { username: 'admin', isAdmin: true };
const ready = { workspaceEnabled: true, workspaceResolved: true, workspaceLoadFailed: false };

describe('Sidebar', () => {
  const adminEntries = [
    'nav.dashboard',
    'nav.servers',
    'nav.groups',
    'nav.prompts',
    'nav.resources',
    'nav.market',
    'nav.users',
    'nav.logs',
    'nav.settings',
  ];
  const workspaceEntries = [
    'workspacePage.home.nav',
    'workspacePage.services.tab',
    'workspacePage.clients.tab',
    'nav.myActivity',
    'nav.keys',
  ];
  const offSettings = { workspaceEnabled: false, workspaceResolved: true, workspaceLoadFailed: false };

  it('gives an ordinary user the workspace pages and API keys, in workspace mode', () => {
    setSettings(alice, ready);
    const html = renderSidebar('/workspace');
    for (const shown of ['nav.workspace', ...workspaceEntries]) expect(html).toContain(shown);
    // Credentials are set from the workspace services list, not from a page of their own.
    expect(html).not.toContain('credentials.title');
    expect(html).not.toContain('href="/credentials"');
    for (const hidden of [
      ...adminEntries,
      'nav.adminConsole',
      'nav.system',
      'nav.manage',
      'nav.account',
      'nav.password',
      'passkeys.title',
      'oauthApprovals.title',
    ]) {
      expect(html).not.toContain(hidden);
    }
  });

  it('links the workspace entries to their pages', () => {
    setSettings(alice, ready);
    const html = renderSidebar('/workspace');
    for (const href of ['/workspace', '/workspace/services', '/workspace/clients', '/keys']) {
      expect(link(html, href)).not.toBe('');
    }
    // Account pages moved to the account settings page and are no longer sidebar entries.
    for (const href of ['/password', '/passkeys', '/oauth-applications']) {
      expect(link(html, href)).toBe('');
    }
  });

  it('shows an administrator the workspace area on personal pages, without admin entries', () => {
    setSettings(admin, ready);
    for (const path of ['/workspace', '/keys', '/account']) {
      const html = renderSidebar(path);
      for (const shown of ['nav.workspace', ...workspaceEntries]) expect(html).toContain(shown);
      expect(html).not.toContain('nav.adminConsole');
      expect(html).not.toContain('nav.servers');
      expect(html).not.toContain('nav.settings');
    }
  });

  it('shows an administrator only the admin console on admin pages', () => {
    setSettings(admin, ready);
    for (const path of ['/dashboard', '/servers', '/settings', '/users', '/credentials']) {
      const html = renderSidebar(path);
      expect(html).toContain('nav.adminConsole');
      for (const shown of adminEntries) expect(html).toContain(shown);
      expect(html).toContain('credentials.adminTitle');
      expect(html).toContain('href="/dashboard"');
      for (const hidden of ['nav.workspace"', 'workspacePage.home.nav', 'nav.keys']) {
        expect(html).not.toContain(hidden);
      }
    }
  });

  it('marks the area with a tag when collapsed, for people who have both', () => {
    setSettings(admin, ready);
    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        { initialEntries: ['/servers'] },
        createElement(Sidebar, { collapsed: true }),
      ),
    );
    expect(html).toContain('hub-tag');
    expect(html).toContain('aria-label="nav.adminConsole"');
    setSettings(alice, ready);
    expect(
      renderToStaticMarkup(
        createElement(
          MemoryRouter,
          { initialEntries: ['/workspace'] },
          createElement(Sidebar, { collapsed: true }),
        ),
      ),
    ).not.toContain('hub-tag');
  });

  it('shows a settings-permission user only Settings in the admin console', () => {
    mockAuthUser = { ...alice, permissions: ['settings:route_config'] } as typeof mockAuthUser;
    mockSettings = { ...mockSettings, ...ready };
    const html = renderSidebar('/settings');
    expect(html).toContain('nav.settings');
    expect(html).toContain('nav.adminConsole');
    expect(html).not.toContain('nav.servers');
    expect(html).not.toContain('nav.users');
  });

  it('keeps one list for everyone while Workspace Mode is off', () => {
    setSettings(alice, offSettings);
    const html = renderSidebar('/dashboard');
    for (const shown of [
      'nav.manage',
      'nav.dashboard',
      'nav.servers',
      'nav.groups',
      'nav.prompts',
      'nav.resources',
      'nav.market',
      'credentials.title',
      'nav.keys',
    ]) {
      expect(html).toContain(shown);
    }
    expect(link(html, '/dashboard')).not.toBe('');
    for (const hidden of ['nav.system', 'nav.settings', 'nav.users', 'nav.adminConsole', 'nav.workspace"']) {
      expect(html).not.toContain(hidden);
    }
  });

  it('adds a System group for an administrator while Workspace Mode is off', () => {
    setSettings(admin, offSettings);
    const html = renderSidebar('/servers');
    for (const shown of ['nav.manage', 'nav.system', 'nav.users', 'nav.logs', 'nav.settings']) {
      expect(html).toContain(shown);
    }
    expect(html).not.toContain('nav.adminConsole');
    expect(html.indexOf('nav.manage')).toBeLessThan(html.indexOf('nav.system'));
  });

  it('renders no admin entries for an ordinary user until the setting is known', () => {
    setSettings(alice, { workspaceEnabled: false, workspaceResolved: false });
    const html = renderSidebar();
    expect(html).not.toContain('nav.servers');
    expect(html).not.toContain('nav.dashboard');
    expect(html).toContain('nav.keys');
  });

  it('falls back to the normal navigation when the settings read failed', () => {
    setSettings(alice, { ...offSettings, workspaceLoadFailed: true });
    const html = renderSidebar();
    expect(html).toContain('nav.servers');
    expect(html).toContain('nav.dashboard');
    expect(html).not.toContain('workspacePage.home.nav');
  });

  describe('the current entry', () => {
    const current = (html: string, href: string) =>
      link(html, href).includes('aria-current="page"');

    it('is Home only on the home page, Services on the list and on a service page', () => {
      setSettings(alice, ready);
      expect(current(renderSidebar('/workspace'), '/workspace')).toBe(true);
      expect(current(renderSidebar('/workspace'), '/workspace/services')).toBe(false);
      expect(current(renderSidebar('/workspace/services'), '/workspace/services')).toBe(true);
      expect(current(renderSidebar('/workspace/services'), '/workspace')).toBe(false);
      expect(
        current(renderSidebar('/workspace/services/ubc-personal'), '/workspace/services'),
      ).toBe(true);
      expect(current(renderSidebar('/workspace/services/ubc-personal'), '/workspace')).toBe(false);
      expect(current(renderSidebar('/workspace/clients'), '/workspace')).toBe(false);
      expect(current(renderSidebar('/workspace/clients'), '/workspace/clients')).toBe(true);
      expect(current(renderSidebar('/workspace/activity'), '/workspace/activity')).toBe(true);
    });

    it('is API keys on the keys page', () => {
      setSettings(alice, ready);
      const html = renderSidebar('/keys');
      expect(current(html, '/keys')).toBe(true);
      expect(current(html, '/workspace')).toBe(false);
    });

    it('is the admin page that is open, and the activity log is not My activity', () => {
      setSettings(admin, ready);
      expect(current(renderSidebar('/dashboard'), '/dashboard')).toBe(true);
      expect(current(renderSidebar('/servers'), '/servers')).toBe(true);
    });
  });
});

describe('RouteAccessGuard', () => {
  it('shows the loading state until the setting is resolved', () => {
    setSettings(alice, {
      workspaceEnabled: false,
      workspaceResolved: false,
      workspaceLoadFailed: false,
    });
    const html = renderGuard('/dashboard');
    expect(html).toContain('app.loading');
    expect(html).not.toContain('DASHBOARD-PAGE');
  });

  it('treats a failed settings read as workspace off and offers a retry', () => {
    setSettings(alice, {
      workspaceEnabled: false,
      workspaceResolved: true,
      workspaceLoadFailed: true,
    });
    const html = renderGuard('/users');
    expect(html).toContain('USERS-PAGE');
    expect(html).not.toContain('app.loading');
    expect(html).toContain('role="alert"');
    expect(html).toContain('workspacePage.settingsFailed');
    expect(html).toContain('workspacePage.retry');
  });

  it('keeps ordinary users out of admin pages in workspace mode', () => {
    setSettings(alice, ready);
    expect(renderGuard('/users')).not.toContain('USERS-PAGE');
    expect(renderGuard('/dashboard')).not.toContain('DASHBOARD-PAGE');
    expect(renderGuard('/workspace')).toContain('WORKSPACE-PAGE');
  });

  it('lets the home path through, where it redirects by itself', () => {
    setSettings(alice, ready);
    expect(renderGuard('/')).toContain('HOME-REDIRECT');
  });

  it('shows admins the dashboard when the mode is on', () => {
    setSettings(admin, ready);
    expect(renderGuard('/dashboard')).toContain('DASHBOARD-PAGE');
  });
});

describe('App routes', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'frontend', 'src', 'App.tsx'), 'utf8');
  it('makes the access guard the only child of the main layout route', () => {
    expect(source).toMatch(
      /<Route element=\{<MainLayout \/>\}>\s*<Route element=\{<RouteAccessGuard \/>\}>/,
    );
    // After the guard's routes come exactly the guard, layout and protected-route closers.
    expect(source).toMatch(
      /<Route path="\/settings" element=\{<SettingsPage \/>\} \/>\s*<\/Route>\s*<\/Route>\s*<\/Route>/,
    );
  });

  it('keeps every page route inside the layout', () => {
    const layout = source.slice(source.indexOf('<MainLayout />'), source.indexOf('path="*"'));
    const pagePaths = [...layout.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]);
    expect(pagePaths).toEqual(
      expect.arrayContaining([
        '/',
        '/workspace',
        '/workspace/services',
        '/workspace/clients',
        '/workspace/activity',
        '/dashboard',
        '/account',
        '/admin',
        '/keys',
        '/password',
        '/passkeys',
        '/oauth-applications',
        '/credentials',
        '/servers',
        '/users',
        '/logs',
        '/activity',
        '/settings',
      ]),
    );
  });
});
