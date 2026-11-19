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
          createElement(Route, { path: '/', element: 'DASHBOARD-PAGE' }),
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
  const personal = ['nav.keys', 'passkeys.title', 'oauthApprovals.title', 'nav.password'];

  it('gives an ordinary user the workspace pages and their own account, in workspace mode', () => {
    setSettings(alice, ready);
    const html = renderSidebar();
    for (const shown of [
      'workspacePage.nav',
      'workspacePage.clients.tab',
      'nav.myActivity',
      'nav.workspace',
      'nav.account',
      ...personal,
    ]) {
      expect(html).toContain(shown);
    }
    // Credentials are set from the workspace services list, not from a page of their own.
    expect(html).not.toContain('credentials.title');
    expect(html).not.toContain('credentials.adminTitle');
    expect(html).not.toContain('href="/credentials"');
    // Nothing is left of the system settings for them.
    expect(html).not.toContain('nav.settings');
    expect(html).not.toContain('nav.system');
    expect(html).not.toContain('nav.manage');
    for (const hidden of [
      'nav.dashboard',
      'nav.servers',
      'nav.groups',
      'nav.prompts',
      'nav.resources',
      'nav.market',
    ]) {
      expect(html).not.toContain(hidden);
    }
  });

  it('links each account entry to its own page', () => {
    setSettings(alice, ready);
    const html = renderSidebar();
    for (const href of ['/keys', '/passkeys', '/oauth-applications', '/password']) {
      expect(link(html, href)).not.toBe('');
    }
  });

  it('lists the sections in order: workspace, then account', () => {
    setSettings(alice, ready);
    const html = renderSidebar();
    expect(html.indexOf('nav.workspace')).toBeLessThan(html.indexOf('nav.account'));
  });

  it('gives an administrator a clearly labelled user credentials entry in workspace mode', () => {
    setSettings(admin, ready);
    const html = renderSidebar();
    expect(html).toContain('href="/credentials"');
    expect(html).toContain('credentials.adminTitle');
  });

  it('keeps the Credentials entry for everyone while Workspace Mode is off', () => {
    setSettings(alice, {
      workspaceEnabled: false,
      workspaceResolved: true,
      workspaceLoadFailed: false,
    });
    const html = renderSidebar();
    expect(html).toContain('credentials.title');
    for (const shown of personal) expect(html).toContain(shown);
  });

  it('renders no admin entries for an ordinary user until the setting is known', () => {
    setSettings(alice, { workspaceEnabled: false, workspaceResolved: false });
    const html = renderSidebar();
    expect(html).not.toContain('nav.servers');
    expect(html).not.toContain('nav.dashboard');
    // The account pages do not depend on it.
    for (const shown of personal) expect(html).toContain(shown);
  });

  it('falls back to the normal navigation when the settings read failed', () => {
    setSettings(alice, {
      workspaceEnabled: false,
      workspaceResolved: true,
      workspaceLoadFailed: true,
    });
    const html = renderSidebar();
    expect(html).toContain('nav.servers');
    expect(html).toContain('nav.dashboard');
    expect(html).not.toContain('workspacePage.nav');
  });

  it('gives admins the same workspace and account entries, plus everything else', () => {
    setSettings(admin, ready);
    const html = renderSidebar();
    for (const shown of [
      'workspacePage.nav',
      'workspacePage.clients.tab',
      ...personal,
      'nav.manage',
      'nav.dashboard',
      'nav.servers',
      'nav.market',
      'nav.system',
      'nav.settings',
    ]) {
      expect(html).toContain(shown);
    }
  });

  it('shows Settings to a person with a settings permission', () => {
    mockAuthUser = { ...alice, permissions: ['settings:route_config'] } as typeof mockAuthUser;
    mockSettings = { ...mockSettings, ...ready };
    expect(renderSidebar()).toContain('nav.settings');
  });

  describe('the current entry', () => {
    const current = (html: string, href: string) =>
      link(html, href).includes('aria-current="page"');

    it('is Workspace on the list and on a service page, not on its sibling pages', () => {
      setSettings(alice, ready);
      expect(current(renderSidebar('/workspace'), '/workspace')).toBe(true);
      expect(current(renderSidebar('/workspace/services/ubc-personal'), '/workspace')).toBe(true);
      expect(current(renderSidebar('/workspace/clients'), '/workspace')).toBe(false);
      expect(current(renderSidebar('/workspace/clients'), '/workspace/clients')).toBe(true);
      expect(current(renderSidebar('/workspace/activity'), '/workspace/activity')).toBe(true);
    });

    it('is the account page that is open', () => {
      setSettings(alice, ready);
      for (const href of ['/keys', '/passkeys', '/oauth-applications', '/password']) {
        const html = renderSidebar(href);
        expect(current(html, href)).toBe(true);
        expect(current(html, '/workspace')).toBe(false);
      }
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
    const html = renderGuard('/');
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
    expect(renderGuard('/workspace')).toContain('WORKSPACE-PAGE');
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
        '/workspace/clients',
        '/workspace/activity',
        '/keys',
        '/password',
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
