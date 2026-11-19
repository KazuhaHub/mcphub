import {
  canViewSystemLogs,
  credentialsRedirect,
  getCredentialsNav,
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
