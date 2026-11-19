import express from 'express';
import request from 'supertest';
import type { ServerConfig } from '../../src/types/index.js';

type ServerRecord = ServerConfig & { name: string };

let servers: ServerRecord[];
let groupNames: string[];
let workspaceConfig: Record<string, unknown> | null;
const selectionRows: Array<{
  username: string;
  serverName: string;
  selected: boolean;
  added?: boolean;
  riskCeiling?: 'read' | 'write' | 'external';
  updatedAt: string;
}> = [];
// Replaces every server's live tools when set.
let liveTools: Array<{ name: string; annotations?: Record<string, unknown> }> | null;
const mockNotifyUserListsChanged = jest.fn();
// Tools each user's own runtime has listed, by username then server name.
let userTools: Record<string, Record<string, Array<{ name: string; annotations?: object }>>>;
const mockPeekServerTools = jest.fn(
  async (serverName: string, principal: { username: string }) =>
    userTools[principal.username]?.[serverName],
);
const mockGetCredentialBindingStatus = jest.fn();
const mockReadinessBounded = jest.fn();
const mockReadinessCheck = jest.fn();

jest.mock('../../src/dao/DaoFactory.js', () => ({
  getGroupDao: () => ({
    findByName: async (name: string) => (groupNames.includes(name) ? { name } : null),
    findById: async () => null,
  }),
  getServerDao: () => ({
    findAll: async () => servers,
    findById: async (name: string) => servers.find((server) => server.name === name) ?? null,
  }),
  getUserServerSelectionDao: () => ({
    listByUsername: async (username: string) =>
      selectionRows.filter((row) => row.username === username),
    save: async (selection: (typeof selectionRows)[number]) => {
      const index = selectionRows.findIndex(
        (row) => row.username === selection.username && row.serverName === selection.serverName,
      );
      const previous = index >= 0 ? selectionRows.splice(index, 1)[0] : undefined;
      const riskCeiling = selection.riskCeiling ?? previous?.riskCeiling;
      // The real DAO keeps what a save leaves out.
      const added = selection.added ?? previous?.added;
      selectionRows.push({
        ...selection,
        selected: selection.selected ?? previous?.selected ?? false,
        ...(added === undefined ? {} : { added }),
        ...(riskCeiling ? { riskCeiling } : {}),
      });
    },
    saveRiskCeiling: async (
      username: string,
      serverName: string,
      riskCeiling: 'read' | 'write' | 'external',
      updatedAt: string,
    ) => {
      const index = selectionRows.findIndex(
        (row) => row.username === username && row.serverName === serverName,
      );
      const previous = index >= 0 ? selectionRows.splice(index, 1)[0] : undefined;
      selectionRows.push({
        selected: false,
        ...previous,
        username,
        serverName,
        riskCeiling,
        updatedAt,
      });
    },
  }),
}));
jest.mock('../../src/utils/systemConfigCache.js', () => ({
  getCachedSystemConfig: () => workspaceConfig,
  setCachedSystemConfig: jest.fn(),
  isDatabaseModeEnabled: () => false,
}));
jest.mock('../../src/config/index.js', () => ({
  getNameSeparator: () => '::',
  default: { basePath: '' },
}));
jest.mock('../../src/services/mcpService.js', () => ({
  getServerByName: (name: string) => ({
    name,
    tools: liveTools ?? [
      { name: `${name}::a`, annotations: { readOnlyHint: true } },
      { name: `${name}::b`, annotations: { readOnlyHint: true } },
      { name: 'bare', annotations: { readOnlyHint: true } },
    ],
  }),
  notifyUserListsChanged: (...args: unknown[]) => mockNotifyUserListsChanged(...args),
  peekServerToolsForPrincipal: (serverName: string, principal: { username: string }) =>
    mockPeekServerTools(serverName, principal),
}));
// Annotations are believed for servers owned by an administrator ("admin" here).
jest.mock('../../src/services/annotationTrustService.js', () => ({
  primeAnnotationTrust: async () => undefined,
  areAnnotationsTrusted: (owner?: string) => !owner || owner === 'admin',
}));
jest.mock('../../src/services/credentialBindingService.js', () => ({
  getCredentialBindingStatus: (...args: unknown[]) => mockGetCredentialBindingStatus(...args),
}));
const mockUsers: Record<string, { username: string; isAdmin?: boolean; userGroups?: string[] }> = {
  alice: { username: 'alice' },
  bob: { username: 'bob' },
  root: { username: 'root', isAdmin: true },
};
jest.mock('../../src/services/userService.js', () => ({
  getUserByUsername: async (username: string) => mockUsers[username],
}));
jest.mock('../../src/services/serviceReadinessService.js', () => ({
  getServiceReadinessBounded: (...args: unknown[]) => mockReadinessBounded(...args),
  getServiceReadiness: (...args: unknown[]) => mockReadinessCheck(...args),
}));
const mockPersonalOAuthLoad = jest.fn();
jest.mock('../../src/services/personalOAuthService.js', () => ({
  hasPersonalOAuth: (config?: { oauth?: { identityMode?: string } }) =>
    config?.oauth?.identityMode === 'personal',
  PersonalOAuthContext: { load: (...args: unknown[]) => mockPersonalOAuthLoad(...args) },
}));

import {
  checkWorkspaceReadiness,
  getServiceManageUrl,
  getWorkspaceEndpoints,
  getWorkspaceSummary,
  listUserServices,
  listWorkspaceServers,
  updateUserService,
  updateWorkspaceMembership,
  updateWorkspaceRisk,
  updateWorkspaceSelection,
} from '../../src/controllers/workspaceController.js';
import { initI18n } from '../../src/utils/i18n.js';
import { clearServerSelectionCache } from '../../src/services/userServerSelectionService.js';
import {
  clearUserServerFailures,
  recordUserServerFailure,
} from '../../src/services/userServerFailureStore.js';

const buildApp = () => {
  const app = express();
  app.use(express.json());
  // Stand-in for dashboard authentication.
  app.use((req, _res, next) => {
    const header = req.headers['x-test-user'];
    if (typeof header === 'string') (req as any).user = JSON.parse(header);
    const language = req.headers['x-test-language'];
    if (typeof language === 'string') (req as any).language = language;
    next();
  });
  app.get('/api/workspace/servers', listWorkspaceServers);
  app.post('/api/workspace/servers/:name/readiness/check', checkWorkspaceReadiness);
  app.get('/api/services/:name/manage-url', getServiceManageUrl);
  app.get('/api/workspace/summary', getWorkspaceSummary);
  app.put('/api/workspace/servers/:name/selection', updateWorkspaceSelection);
  app.put('/api/workspace/servers/:name/membership', updateWorkspaceMembership);
  app.get('/api/users/:username/services', listUserServices);
  app.put('/api/users/:username/services/:name', updateUserService);
  app.put('/api/workspace/servers/:name/risk', updateWorkspaceRisk);
  app.get('/api/workspace/endpoints', getWorkspaceEndpoints);
  return app;
};

const asUser = (username: string, isAdmin = false) => JSON.stringify({ username, isAdmin });

describe('workspace API', () => {
  const app = buildApp();

  beforeEach(() => {
    jest.clearAllMocks();
    selectionRows.length = 0;
    liveTools = null;
    userTools = {};
    groupNames = [];
    clearServerSelectionCache();
    clearUserServerFailures();
    mockPersonalOAuthLoad.mockReset();
    workspaceConfig = { workspace: { enabled: true } };
    mockGetCredentialBindingStatus.mockResolvedValue({ configured: false });
    servers = [
      {
        name: 'public-tool',
        owner: 'admin',
        visibility: 'public',
        description: 'Shared',
        manageUrl: 'https://tool.example.com/account',
      },
      { name: 'private-tool', owner: 'admin', visibility: 'private' },
      { name: 'alice-tool', owner: 'alice', visibility: 'private', enabled: false },
      {
        name: 'needs-key',
        owner: 'admin',
        visibility: 'public',
        credentialTemplate: [{ target: 'env', name: 'API_KEY' }],
      },
    ];
  });

  describe('when the workspace setting is off', () => {
    it.each([{}, { workspace: { enabled: false } }, null])(
      'answers 404 on every route for %j',
      async (config) => {
        workspaceConfig = config;
        const headers = { 'x-test-user': asUser('alice') };

        await request(app).get('/api/workspace/servers').set(headers).expect(404);
        await request(app)
          .put('/api/workspace/servers/public-tool/selection')
          .set(headers)
          .send({ selected: true })
          .expect(404);
        await request(app).get('/api/workspace/endpoints').set(headers).expect(404);
        expect(selectionRows).toEqual([]);
      },
    );
  });

  it('requires an authenticated user', async () => {
    await request(app).get('/api/workspace/servers').expect(401);
  });

  describe('GET /workspace/servers', () => {
    it('lists the servers visible to the user with their selection state', async () => {
      selectionRows.push({
        username: 'alice',
        serverName: 'public-tool',
        selected: true,
        updatedAt: '2026-01-01T00:00:00.000Z',
      });

      const response = await request(app)
        .get('/api/workspace/servers')
        .set('x-test-user', asUser('alice'))
        .expect(200);

      expect(response.body.data).toEqual([
        {
          name: 'public-tool',
          added: true,
          tags: [],
          description: 'Shared',
          manageUrl: 'https://tool.example.com/account',
          selected: true,
          enabled: true,
          toolCount: 3,
          riskCeiling: 'read',
          riskCeilingIsDefault: true,
          riskCounts: { read: 3, write: 0, external: 0 },
          maxAllowedRisk: 'external',
          annotationsTrusted: true,
          requiresPersonalCredential: false,
          hasCredentialSlots: false,
          credentialConfigured: true,
          readiness: null,
          status: { code: 'available', action: null, message: expect.any(String) },
        },
        {
          name: 'alice-tool',
          added: false,
          tags: [],
          selected: false,
          enabled: false,
          toolCount: 0,
          riskCeiling: 'read',
          riskCeilingIsDefault: true,
          riskCounts: { read: 0, write: 0, external: 3 },
          maxAllowedRisk: 'external',
          annotationsTrusted: false,
          requiresPersonalCredential: false,
          hasCredentialSlots: false,
          credentialConfigured: true,
          readiness: null,
          status: { code: 'not_selected', action: 'select', message: expect.any(String) },
        },
        {
          name: 'needs-key',
          added: false,
          tags: [],
          selected: false,
          enabled: true,
          toolCount: null,
          riskCeiling: 'read',
          riskCeilingIsDefault: true,
          riskCounts: null,
          maxAllowedRisk: 'external',
          annotationsTrusted: true,
          requiresPersonalCredential: true,
          hasCredentialSlots: true,
          credentialConfigured: false,
          readiness: null,
          status: { code: 'not_selected', action: 'select', message: expect.any(String) },
        },
      ]);
      expect(mockGetCredentialBindingStatus).toHaveBeenCalledWith(
        'needs-key',
        'alice',
        expect.objectContaining({ name: 'needs-key' }),
      );
    });

    it('lists a service icon as a versioned URL and leaves it out when there is none', async () => {
      const png = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.from('pixels'),
      ]);
      servers[0].icon = `data:image/png;base64,${png.toString('base64')}`;

      const response = await request(app)
        .get('/api/workspace/servers')
        .set('x-test-user', asUser('alice'))
        .expect(200);

      const byName = Object.fromEntries(
        response.body.data.map((server: { name: string }) => [server.name, server]),
      );
      expect(byName['public-tool'].icon).toMatch(
        /\/api\/servers\/public-tool\/icon\?v=[0-9a-f]{12}$/,
      );
      expect(byName['needs-key']).not.toHaveProperty('icon');
      expect(JSON.stringify(response.body)).not.toContain('base64');
    });

    it('reports a configured personal credential', async () => {
      mockGetCredentialBindingStatus.mockResolvedValue({ configured: true });

      const response = await request(app)
        .get('/api/workspace/servers')
        .set('x-test-user', asUser('bob'))
        .expect(200);

      expect(
        response.body.data.find((server: { name: string }) => server.name === 'needs-key'),
      ).toMatchObject({ requiresPersonalCredential: true, credentialConfigured: true });
    });

    describe('a service needing personal credentials', () => {
      const needsKey = async (username: string) => {
        const response = await request(app)
          .get('/api/workspace/servers')
          .set('x-test-user', asUser(username))
          .expect(200);
        return response.body.data.find((server: { name: string }) => server.name === 'needs-key');
      };

      it('counts the connected user’s own tools', async () => {
        mockGetCredentialBindingStatus.mockResolvedValue({ configured: true });
        userTools.bob = {
          'needs-key': [
            { name: 'needs-key::get', annotations: { readOnlyHint: true } },
            { name: 'needs-key::list', annotations: { readOnlyHint: true } },
            { name: 'needs-key::post', annotations: { readOnlyHint: false } },
          ],
        };

        expect(await needsKey('bob')).toMatchObject({
          toolCount: 2,
          riskCounts: { read: 2, write: 0, external: 1 },
        });
      });

      it('reports unknown tools, not zero, when the connected user has no runtime yet', async () => {
        mockGetCredentialBindingStatus.mockResolvedValue({ configured: true });

        expect(await needsKey('bob')).toMatchObject({
          credentialConfigured: true,
          toolCount: null,
          riskCounts: null,
        });
      });

      it('gives each user the counts of their own tools, never another user’s', async () => {
        mockGetCredentialBindingStatus.mockResolvedValue({ configured: true });
        userTools.alice = {
          'needs-key': [
            { name: 'needs-key::a', annotations: { readOnlyHint: true } },
            { name: 'needs-key::b', annotations: { readOnlyHint: true } },
            { name: 'needs-key::c', annotations: { readOnlyHint: true } },
            { name: 'needs-key::d', annotations: { readOnlyHint: true } },
          ],
        };
        userTools.bob = {
          'needs-key': [{ name: 'needs-key::a', annotations: { readOnlyHint: true } }],
        };

        expect(await needsKey('alice')).toMatchObject({ toolCount: 4 });
        expect(await needsKey('bob')).toMatchObject({ toolCount: 1 });
        expect(await needsKey('carol')).toMatchObject({ toolCount: null, riskCounts: null });
        for (const [, principal] of mockPeekServerTools.mock.calls)
          expect(['alice', 'bob', 'carol']).toContain(principal.username);
      });

      it('does not look at tools until the user has connected', async () => {
        userTools.bob = { 'needs-key': [{ name: 'needs-key::get' }] };

        expect(await needsKey('bob')).toMatchObject({ toolCount: null, riskCounts: null });
        expect(mockPeekServerTools).not.toHaveBeenCalled();
      });
    });

    it('shows an admin every server, as the dashboard does', async () => {
      const response = await request(app)
        .get('/api/workspace/servers')
        .set('x-test-user', asUser('root', true))
        .expect(200);

      expect(response.body.data).toHaveLength(4);
    });
  });

  describe('service readiness', () => {
    const ready = {
      state: 'needs_setup',
      summary: 'No Canvas token saved',
      action: { label: 'Set up Canvas token', url: 'https://canvas.example.com/setup' },
      expiresAt: null,
      checkedAt: '2026-11-19T10:00:00.000Z',
    };
    const alice = { 'x-test-user': asUser('alice') };
    const withReadiness = (extra: object = {}) => {
      servers = [
        {
          name: 'canvas',
          owner: 'admin',
          visibility: 'public',
          credentialTemplate: [{ target: 'headers', name: 'X-Canvas-Token' }],
          readiness: {
            url: 'https://svc.example.com/ready',
            auth: { credential: 'X-Canvas-Token' },
          },
          ...extra,
        },
      ];
    };
    const item = async () =>
      (await request(app).get('/api/workspace/servers').set(alice).expect(200)).body.data[0];

    beforeEach(() => {
      mockReadinessBounded.mockReset();
      mockReadinessCheck.mockReset();
      mockReadinessBounded.mockResolvedValue(ready);
      mockReadinessCheck.mockResolvedValue(ready);
    });

    it('adds the probe result to a service whose credential is configured', async () => {
      withReadiness();
      mockGetCredentialBindingStatus.mockResolvedValue({ configured: true });
      expect((await item()).readiness).toEqual(ready);
      expect(mockReadinessBounded).toHaveBeenCalledTimes(1);
      const [user, name, definition] = mockReadinessBounded.mock.calls[0];
      expect(user).toMatchObject({ username: 'alice' });
      expect(name).toBe('canvas');
      expect(definition.readiness.url).toBe('https://svc.example.com/ready');
    });

    it('is null, and never probes, while the credential is missing', async () => {
      withReadiness();
      mockGetCredentialBindingStatus.mockResolvedValue({ configured: false });
      expect((await item()).readiness).toBeNull();
      expect(mockReadinessBounded).not.toHaveBeenCalled();
    });

    it('is null for a service without a readiness declaration', async () => {
      withReadiness({ readiness: undefined });
      mockGetCredentialBindingStatus.mockResolvedValue({ configured: true });
      expect((await item()).readiness).toBeNull();
      expect(mockReadinessBounded).not.toHaveBeenCalled();
    });

    it('probes a personal OAuth service once the user is connected', async () => {
      withReadiness({
        credentialTemplate: undefined,
        oauth: { identityMode: 'personal' },
        readiness: { url: 'https://svc.example.com/ready', auth: 'oauth' },
      });
      mockPersonalOAuthLoad.mockResolvedValue({ config: { oauth: { accessToken: 't' } } });
      expect((await item()).readiness).toEqual(ready);
    });

    it('never lets a failing probe break the list', async () => {
      withReadiness();
      mockGetCredentialBindingStatus.mockResolvedValue({ configured: true });
      mockReadinessBounded.mockRejectedValue(new Error('boom'));
      const body = await item();
      expect(body.name).toBe('canvas');
      expect(body.readiness).toMatchObject({ state: 'unknown', summary: null, action: null });
    });

    it.each([
      ['disabled', { enabled: false }],
      ['paused for this user', { pausedUsers: ['alice'] }],
      ['in maintenance', { maintenance: { message: 'Upgrading' } }],
    ])(
      'does not probe a service that is %s: the hub status takes precedence',
      async (_label, extra) => {
        withReadiness(extra);
        mockGetCredentialBindingStatus.mockResolvedValue({ configured: true });
        expect((await item()).readiness).toBeNull();
        expect(mockReadinessBounded).not.toHaveBeenCalled();
        const response = await request(app)
          .post('/api/workspace/servers/canvas/readiness/check')
          .set(alice)
          .expect(200);
        expect(response.body.data.readiness).toBeNull();
        expect(mockReadinessCheck).not.toHaveBeenCalled();
      },
    );

    it('still probes for an administrator in maintenance, as they bypass it', async () => {
      withReadiness({ maintenance: { message: 'Upgrading' } });
      mockGetCredentialBindingStatus.mockResolvedValue({ configured: true });
      const response = await request(app)
        .get('/api/workspace/servers')
        .set('x-test-user', asUser('root', true))
        .expect(200);
      expect(response.body.data[0].readiness).toEqual(ready);
    });

    describe('POST /workspace/servers/:name/readiness/check', () => {
      const post = (name = 'canvas', headers: Record<string, string> = alice) =>
        request(app).post(`/api/workspace/servers/${name}/readiness/check`).set(headers);

      it('bypasses the cache for one service', async () => {
        withReadiness();
        mockGetCredentialBindingStatus.mockResolvedValue({ configured: true });
        const response = await post().expect(200);
        expect(response.body).toEqual({
          success: true,
          data: { name: 'canvas', readiness: ready },
        });
        expect(mockReadinessCheck).toHaveBeenCalledWith(
          expect.objectContaining({ username: 'alice' }),
          'canvas',
          expect.objectContaining({ name: 'canvas' }),
          { refresh: true },
        );
      });

      it('answers null without probing when the credential is not configured', async () => {
        withReadiness();
        mockGetCredentialBindingStatus.mockResolvedValue({ configured: false });
        const response = await post().expect(200);
        expect(response.body.data.readiness).toBeNull();
        expect(mockReadinessCheck).not.toHaveBeenCalled();
      });

      it('answers unknown instead of failing when the probe throws', async () => {
        withReadiness();
        mockGetCredentialBindingStatus.mockResolvedValue({ configured: true });
        mockReadinessCheck.mockRejectedValue(new Error('boom'));
        const response = await post().expect(200);
        expect(response.body.data.readiness.state).toBe('unknown');
      });

      it('requires a user, hides services the user cannot see, and follows the workspace switch', async () => {
        withReadiness({ visibility: 'private', owner: 'bob' });
        await post('canvas', {}).expect(401);
        await post('canvas').expect(404);
        await post('missing').expect(404);
        workspaceConfig = { workspace: { enabled: false } };
        withReadiness();
        await post().expect(404);
        expect(mockReadinessCheck).not.toHaveBeenCalled();
      });
    });
  });

  describe('server status', () => {
    const select = (username: string, ...names: string[]) =>
      names.forEach((serverName) =>
        selectionRows.push({ username, serverName, selected: true, updatedAt: '2026-01-01' }),
      );
    const statusOf = async (user = 'alice', headers: Record<string, string> = {}) => {
      const response = await request(app)
        .get('/api/workspace/servers')
        .set({ 'x-test-user': asUser(user), ...headers })
        .expect(200);
      return Object.fromEntries(
        response.body.data.map((server: { name: string; status: unknown }) => [
          server.name,
          server.status,
        ]),
      ) as Record<string, { code: string; action: string | null; message: string; since?: string }>;
    };

    it('reports the first state that applies to each server', async () => {
      select('alice', 'public-tool', 'alice-tool', 'needs-key');
      const status = await statusOf();
      expect(status['public-tool']).toMatchObject({ code: 'available', action: null });
      expect(status['alice-tool']).toMatchObject({ code: 'paused', action: 'contact_admin' });
      expect(status['needs-key']).toMatchObject({ code: 'needs_auth', action: 'connect' });
      expect(status['needs-key'].message).toContain('needs-key');
    });

    it('reports maintenance and a per-user pause without exposing who else is paused', async () => {
      servers[0] = {
        ...servers[0],
        maintenance: { until: '2999-01-01T00:00:00.000Z', message: 'Upgrading.' },
        pausedUsers: ['alice', 'bob'],
      };
      servers[3] = { ...servers[3], credentialTemplate: undefined, pausedUsers: ['bob'] };
      select('alice', 'public-tool', 'needs-key');
      select('bob', 'public-tool', 'needs-key');

      const response = await request(app)
        .get('/api/workspace/servers')
        .set({ 'x-test-user': asUser('alice') })
        .expect(200);
      const status = Object.fromEntries(
        response.body.data.map((server: { name: string; status: unknown }) => [
          server.name,
          server.status,
        ]),
      ) as Record<string, Record<string, string>>;

      // Paused for alice outranks maintenance.
      expect(status['public-tool']).toMatchObject({ code: 'paused', action: 'contact_admin' });
      expect(status['needs-key'].code).toBe('available');
      expect(JSON.stringify(response.body)).not.toContain('pausedUsers');
      expect(JSON.stringify(response.body)).not.toContain('bob');

      // Carol is not paused, so she meets the maintenance window.
      select('carol', 'public-tool');
      const selected = await request(app)
        .get('/api/workspace/servers')
        .set({ 'x-test-user': asUser('carol') })
        .expect(200);
      expect(
        selected.body.data.find((s: { name: string }) => s.name === 'public-tool').status,
      ).toMatchObject({
        code: 'maintenance',
        action: 'retry_later',
        until: '2999-01-01T00:00:00.000Z',
        message: expect.stringContaining('Upgrading.'),
      });
    });

    it('stops counting an expired maintenance window', async () => {
      servers[0] = { ...servers[0], maintenance: { until: '2000-01-01T00:00:00.000Z' } };
      select('alice', 'public-tool');
      expect((await statusOf())['public-tool'].code).toBe('available');
    });

    it('reports an unselected server as not_selected whatever else is wrong with it', async () => {
      expect((await statusOf())['alice-tool']).toMatchObject({
        code: 'not_selected',
        action: 'select',
      });
    });

    it('treats a configured credential as available', async () => {
      select('alice', 'needs-key');
      mockGetCredentialBindingStatus.mockResolvedValue({ configured: true });
      expect((await statusOf())['needs-key'].code).toBe('available');
    });

    it('sends a user who cannot hold personal credentials to the administrator', async () => {
      select('alice', 'needs-key');
      const response = await request(app)
        .get('/api/workspace/servers')
        .set('x-test-user', JSON.stringify({ username: 'alice', credentialEligible: false }))
        .expect(200);
      const entry = response.body.data.find(
        (server: { name: string }) => server.name === 'needs-key',
      );
      expect(entry.status).toMatchObject({ code: 'needs_auth', action: 'contact_admin' });
    });

    it('reports a rejected credential only for the user it was rejected for', async () => {
      select('alice', 'needs-key');
      select('bob', 'needs-key');
      mockGetCredentialBindingStatus.mockResolvedValue({ configured: true });
      recordUserServerFailure('alice', 'needs-key', 'auth');
      const alice = (await statusOf('alice'))['needs-key'];
      expect(alice).toMatchObject({ code: 'credential_invalid', action: 'connect' });
      expect(alice.since).toEqual(expect.any(String));
      expect((await statusOf('bob'))['needs-key'].code).toBe('available');
    });

    it('reports a remembered non-auth failure as error', async () => {
      select('alice', 'public-tool');
      recordUserServerFailure('alice', 'public-tool', 'runtime');
      expect((await statusOf())['public-tool']).toMatchObject({
        code: 'error',
        action: 'retry_later',
      });
    });

    it('reports credential slots only for a credential template, not for a personal sign-in', async () => {
      servers.push({
        name: 'oauth-only',
        owner: 'admin',
        visibility: 'public',
        oauth: { identityMode: 'personal' },
      } as ServerRecord);
      const response = await request(app)
        .get('/api/workspace/servers')
        .set('x-test-user', asUser('alice'))
        .expect(200);
      const byName = Object.fromEntries(
        response.body.data.map((server: { name: string }) => [server.name, server]),
      );
      expect(byName['oauth-only']).toMatchObject({
        requiresPersonalCredential: true,
        hasCredentialSlots: false,
      });
      expect(byName['needs-key']).toMatchObject({
        requiresPersonalCredential: true,
        hasCredentialSlots: true,
      });
    });

    it('distinguishes a disconnected personal OAuth server from one never connected', async () => {
      servers.push({
        name: 'oauth-tool',
        owner: 'admin',
        visibility: 'public',
        oauth: { identityMode: 'personal' },
      } as ServerRecord);
      select('alice', 'oauth-tool');
      mockPersonalOAuthLoad.mockResolvedValue({
        config: { oauth: {} },
        disconnected: true,
      });
      expect((await statusOf())['oauth-tool']).toMatchObject({
        code: 'revoked',
        action: 'connect',
      });
      mockPersonalOAuthLoad.mockResolvedValue({ config: { oauth: {} }, disconnected: false });
      expect((await statusOf())['oauth-tool'].code).toBe('needs_auth');
      mockPersonalOAuthLoad.mockResolvedValue({
        config: { oauth: { accessToken: 'secret' } },
        disconnected: false,
      });
      expect((await statusOf())['oauth-tool'].code).toBe('available');
    });

    it('translates the message into the request language', async () => {
      await initI18n();
      select('alice', 'needs-key');
      const status = await statusOf('alice', { 'x-test-language': 'zh' });
      expect(status['needs-key'].message).toContain('needs-key');
      expect(status['needs-key'].message).toMatch(/[\u4e00-\u9fff]/);
    });
  });

  describe('GET /workspace/summary', () => {
    const select = (username: string, ...names: string[]) =>
      names.forEach((serverName) =>
        selectionRows.push({ username, serverName, selected: true, updatedAt: '2026-01-01' }),
      );
    const summary = async (user = 'alice') =>
      (
        await request(app)
          .get('/api/workspace/summary')
          .set('x-test-user', asUser(user))
          .expect(200)
      ).body.data;

    it('answers 404 when the workspace setting is off', async () => {
      workspaceConfig = {};
      await request(app)
        .get('/api/workspace/summary')
        .set('x-test-user', asUser('alice'))
        .expect(404);
    });

    it('requires an authenticated user', async () => {
      await request(app).get('/api/workspace/summary').expect(401);
    });

    it('is empty when nothing is selected', async () => {
      expect(await summary()).toEqual({
        endpointState: 'empty',
        counts: {
          available: 0,
          not_selected: 3,
          paused: 0,
          maintenance: 0,
          needs_auth: 0,
          revoked: 0,
          credential_invalid: 0,
          error: 0,
        },
      });
    });

    it('is normal when everything selected is available', async () => {
      select('alice', 'public-tool');
      expect(await summary()).toMatchObject({
        endpointState: 'normal',
        counts: { available: 1, not_selected: 2 },
      });
    });

    it('is partial when some selected server is not available', async () => {
      select('alice', 'public-tool', 'needs-key');
      expect(await summary()).toMatchObject({
        endpointState: 'partial',
        counts: { available: 1, needs_auth: 1, not_selected: 1 },
      });
    });

    it('is empty when every selected server is unavailable', async () => {
      select('alice', 'needs-key');
      expect((await summary()).endpointState).toBe('empty');
    });
  });

  describe('GET /services/:name/manage-url', () => {
    const get = (name: string, user?: string) => {
      const req = request(app).get(`/api/services/${name}/manage-url`);
      return user ? req.set('x-test-user', asUser(user)) : req;
    };

    it('returns the link of a visible service, even with Workspace Mode off', async () => {
      workspaceConfig = null;
      const response = await get('public-tool', 'alice').expect(200);
      expect(response.body.data).toEqual({
        name: 'public-tool',
        manageUrl: 'https://tool.example.com/account',
      });
    });

    it('returns null for a visible service without a link', async () => {
      const response = await get('needs-key', 'alice').expect(200);
      expect(response.body.data.manageUrl).toBeNull();
    });

    it('answers 404 alike for a service the user cannot see and one that does not exist', async () => {
      const hidden = await get('private-tool', 'alice').expect(404);
      const missing = await get('nope', 'alice').expect(404);
      expect(hidden.body).toEqual(missing.body);
    });

    it('requires an authenticated user', async () => {
      await get('public-tool').expect(401);
    });
  });

  describe('PUT /workspace/servers/:name/selection', () => {
    const select = (name: string, body: unknown, user = 'alice') =>
      request(app)
        .put(`/api/workspace/servers/${name}/selection`)
        .set('x-test-user', asUser(user))
        .send(body as object);

    it('stores the selection for the session user and notifies only that user', async () => {
      await select('public-tool', { selected: true }).expect(200);

      expect(selectionRows).toEqual([
        expect.objectContaining({ username: 'alice', serverName: 'public-tool', selected: true }),
      ]);
      expect(mockNotifyUserListsChanged).toHaveBeenCalledTimes(1);
      expect(mockNotifyUserListsChanged).toHaveBeenCalledWith('alice');

      await select('public-tool', { selected: false }).expect(200);
      expect(selectionRows).toEqual([
        expect.objectContaining({ username: 'alice', serverName: 'public-tool', selected: false }),
      ]);
    });

    it('takes the username from the session, never from the request', async () => {
      await select('public-tool', { selected: true, username: 'mallory' }).expect(200);
      await request(app)
        .put('/api/workspace/servers/public-tool/selection?username=mallory')
        .set('x-test-user', asUser('alice'))
        .send({ selected: true })
        .expect(200);

      expect(selectionRows.map((row) => row.username)).toEqual(['alice']);
      expect(mockNotifyUserListsChanged).not.toHaveBeenCalledWith('mallory');
    });

    it('answers 404 for a server the user cannot see, and for one that does not exist', async () => {
      await select('private-tool', { selected: true }).expect(404);
      await select('missing', { selected: true }).expect(404);

      expect(selectionRows).toEqual([]);
      expect(mockNotifyUserListsChanged).not.toHaveBeenCalled();
    });

    it.each([{}, { selected: 'yes' }, { selected: 1 }, { selected: null }])(
      'answers 400 for the body %j',
      async (body) => {
        await select('public-tool', body).expect(400);
        expect(selectionRows).toEqual([]);
      },
    );
  });

  describe('GET /workspace/endpoints', () => {
    it('builds the aggregate and single-server URLs of the selected, enabled servers', async () => {
      workspaceConfig = {
        workspace: { enabled: true },
        install: { baseUrl: 'https://hub.example.com/mcphub/' },
      };
      const now = '2026-01-01T00:00:00.000Z';
      selectionRows.push(
        { username: 'alice', serverName: 'public-tool', selected: true, updatedAt: now },
        // Selected, but globally disabled.
        { username: 'alice', serverName: 'alice-tool', selected: true, updatedAt: now },
        // Explicitly deselected.
        { username: 'alice', serverName: 'needs-key', selected: false, updatedAt: now },
        // Another user's choice.
        { username: 'bob', serverName: 'needs-key', selected: true, updatedAt: now },
      );

      const response = await request(app)
        .get('/api/workspace/endpoints')
        .set('x-test-user', asUser('alice'))
        .expect(200);

      expect(response.body.data).toEqual({
        aggregate: 'https://hub.example.com/mcphub/alice/mcp',
        servers: [
          { name: 'public-tool', url: 'https://hub.example.com/mcphub/alice/mcp/public-tool' },
        ],
      });
    });

    it('gives no per-server URL to a server whose name is also a group', async () => {
      groupNames = ['public-tool'];
      const now = '2026-01-01T00:00:00.000Z';
      selectionRows.push(
        { username: 'alice', serverName: 'public-tool', selected: true, updatedAt: now },
        { username: 'alice', serverName: 'needs-key', selected: true, updatedAt: now },
      );

      const response = await request(app)
        .get('/api/workspace/endpoints')
        .set('x-test-user', asUser('alice'))
        .set('Host', 'localhost:3000')
        .expect(200);

      expect(response.body.data.servers).toEqual([
        { name: 'public-tool', url: null, conflict: 'group-name' },
        { name: 'needs-key', url: 'http://localhost:3000/alice/mcp/needs-key' },
      ]);
    });

    it('falls back to the request host when no base URL is configured', async () => {
      const response = await request(app)
        .get('/api/workspace/endpoints')
        .set('x-test-user', asUser('alice'))
        .set('Host', 'localhost:3000')
        .expect(200);

      expect(response.body.data).toEqual({
        aggregate: 'http://localhost:3000/alice/mcp',
        servers: [],
      });
    });
  });
});

describe('workspace API: tool risk levels', () => {
  const app = buildApp();
  const alice = { 'x-test-user': asUser('alice') };
  const root = { 'x-test-user': asUser('root', true) };

  // get: read-only; edit: closed world; send: no annotations; drop: disabled in the config.
  const tools = [
    { name: 'svc::get', annotations: { readOnlyHint: true } },
    { name: 'svc::edit', annotations: { openWorldHint: false } },
    { name: 'svc::edit2', annotations: { openWorldHint: false } },
    { name: 'svc::send' },
    { name: 'svc::drop' },
  ];
  const view = async (headers: Record<string, string> = alice) =>
    (await request(app).get('/api/workspace/servers').set(headers).expect(200)).body.data.find(
      (entry: { name: string }) => entry.name === 'svc',
    );

  beforeEach(() => {
    jest.clearAllMocks();
    selectionRows.length = 0;
    groupNames = [];
    clearServerSelectionCache();
    clearUserServerFailures();
    workspaceConfig = { workspace: { enabled: true } };
    mockGetCredentialBindingStatus.mockResolvedValue({ configured: false });
    liveTools = tools;
    servers = [
      {
        name: 'svc',
        owner: 'admin',
        visibility: 'public',
        tools: { 'svc::drop': { enabled: false } },
      },
    ];
  });

  it('reports the ceiling (read by default), the counts by level and the cap', async () => {
    const entry = await view();
    expect(entry.riskCeiling).toBe('read');
    expect(entry.riskCounts).toEqual({ read: 1, write: 2, external: 1 });
    expect(entry.maxAllowedRisk).toBe('external');
    // Only tools within the ceiling are counted as exposed.
    expect(entry.toolCount).toBe(1);
  });

  it('counts tools as the ceiling rises', async () => {
    await request(app)
      .put('/api/workspace/servers/svc/risk')
      .set(alice)
      .send({ riskCeiling: 'write' })
      .expect(200);
    expect((await view()).toolCount).toBe(3);
    await request(app)
      .put('/api/workspace/servers/svc/risk')
      .set(alice)
      .send({ riskCeiling: 'external' })
      .expect(200);
    expect((await view()).toolCount).toBe(4);
  });

  it('counts only tools within the administrator’s cap, using effective levels', async () => {
    servers[0].maxToolRisk = 'write';
    servers[0].toolRiskOverrides = { 'svc::edit2': 'external', get: 'write', send: 'read' };

    const entry = await view();
    expect(entry.maxAllowedRisk).toBe('write');
    expect(entry.riskCounts).toEqual({ read: 0, write: 2, external: 0 });

    // Administrators are not capped.
    const adminEntry = await view(root);
    expect(adminEntry.maxAllowedRisk).toBe('external');
    expect(adminEntry.riskCounts).toEqual({ read: 0, write: 2, external: 2 });
  });

  it('stores the ceiling without selecting, notifies only that user, and keeps it through selection', async () => {
    await request(app)
      .put('/api/workspace/servers/svc/risk')
      .set(alice)
      .send({ riskCeiling: 'write' })
      .expect(200, { success: true, data: { name: 'svc', riskCeiling: 'write' } });

    expect(selectionRows).toEqual([
      expect.objectContaining({
        username: 'alice',
        serverName: 'svc',
        selected: false,
        riskCeiling: 'write',
      }),
    ]);
    expect(mockNotifyUserListsChanged).toHaveBeenCalledTimes(1);
    expect(mockNotifyUserListsChanged).toHaveBeenCalledWith('alice');
    expect((await view()).selected).toBe(false);

    await request(app)
      .put('/api/workspace/servers/svc/selection')
      .set(alice)
      .send({ selected: true })
      .expect(200);
    expect(selectionRows[0]).toMatchObject({ selected: true, riskCeiling: 'write' });
    expect((await view()).riskCeiling).toBe('write');
  });

  it('does not change a selection that already exists', async () => {
    selectionRows.push({
      username: 'alice',
      serverName: 'svc',
      selected: true,
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    await request(app)
      .put('/api/workspace/servers/svc/risk')
      .set(alice)
      .send({ riskCeiling: 'external' })
      .expect(200);
    expect(selectionRows).toEqual([
      expect.objectContaining({ selected: true, riskCeiling: 'external' }),
    ]);
  });

  it('keeps each user’s ceiling apart', async () => {
    await request(app)
      .put('/api/workspace/servers/svc/risk')
      .set(alice)
      .send({ riskCeiling: 'external' })
      .expect(200);
    expect((await view({ 'x-test-user': asUser('bob') })).riskCeiling).toBe('read');
  });

  it('rejects invalid bodies with 400', async () => {
    for (const body of [{}, { riskCeiling: 'admin' }, { riskCeiling: 1 }, { riskCeiling: null }]) {
      await request(app).put('/api/workspace/servers/svc/risk').set(alice).send(body).expect(400);
    }
    expect(selectionRows).toEqual([]);
  });

  it('rejects a level above the administrator’s cap with 400, but not for an administrator', async () => {
    servers[0].maxToolRisk = 'write';
    await request(app)
      .put('/api/workspace/servers/svc/risk')
      .set(alice)
      .send({ riskCeiling: 'external' })
      .expect(400);
    await request(app)
      .put('/api/workspace/servers/svc/risk')
      .set(alice)
      .send({ riskCeiling: 'write' })
      .expect(200);
    await request(app)
      .put('/api/workspace/servers/svc/risk')
      .set(root)
      .send({ riskCeiling: 'external' })
      .expect(200);
  });

  it('requires a visible server, as selection does', async () => {
    servers.push({ name: 'secret', owner: 'admin', visibility: 'private' });
    await request(app)
      .put('/api/workspace/servers/secret/risk')
      .set(alice)
      .send({ riskCeiling: 'write' })
      .expect(404);
    await request(app)
      .put('/api/workspace/servers/missing/risk')
      .set(alice)
      .send({ riskCeiling: 'write' })
      .expect(404);
    expect(selectionRows).toEqual([]);
    expect(mockNotifyUserListsChanged).not.toHaveBeenCalled();
  });

  it('answers 404 when the setting is off and 401 without a user', async () => {
    workspaceConfig = { workspace: { enabled: false } };
    await request(app)
      .put('/api/workspace/servers/svc/risk')
      .set(alice)
      .send({ riskCeiling: 'write' })
      .expect(404);
    workspaceConfig = { workspace: { enabled: true } };
    await request(app)
      .put('/api/workspace/servers/svc/risk')
      .send({ riskCeiling: 'write' })
      .expect(401);
  });

  it('reports the administrator’s default as the ceiling until the user chooses, clamped by the cap', async () => {
    servers[0].defaultUserRisk = 'write';
    let entry = await view();
    expect(entry).toMatchObject({ riskCeiling: 'write', riskCeilingIsDefault: true, toolCount: 3 });

    // A cap under the default wins.
    servers[0].maxToolRisk = 'read';
    entry = await view();
    expect(entry).toMatchObject({ riskCeiling: 'read', riskCeilingIsDefault: true, toolCount: 1 });

    servers[0].maxToolRisk = undefined;
    await request(app)
      .put('/api/workspace/servers/svc/risk')
      .set(alice)
      .send({ riskCeiling: 'read' })
      .expect(200);
    entry = await view();
    expect(entry).toMatchObject({ riskCeiling: 'read', riskCeilingIsDefault: false, toolCount: 1 });
    // The default itself is the administrator's business.
    expect(JSON.stringify(entry)).not.toContain('defaultUserRisk');
    // Another user is unaffected by alice's choice.
    expect(await view({ 'x-test-user': asUser('bob') })).toMatchObject({
      riskCeiling: 'write',
      riskCeilingIsDefault: true,
    });
  });

  it('reports unknown tools, not zeros, for a service with personal credentials and no shared list', async () => {
    liveTools = [];
    servers[0].credentialTemplate = [{ target: 'env', name: 'API_KEY' }];
    const entry = await view();
    expect(entry.toolCount).toBeNull();
    expect(entry.riskCounts).toBeNull();
    // A service with no credentials and no tools genuinely has none.
    servers[0].credentialTemplate = undefined;
    expect(await view()).toMatchObject({
      toolCount: 0,
      riskCounts: { read: 0, write: 0, external: 0 },
    });
  });

  it('counts every tool of a server a non-admin owns as external and says annotations are not trusted', async () => {
    servers[0].owner = 'alice';
    const entry = await view();
    expect(entry.annotationsTrusted).toBe(false);
    expect(entry.riskCounts).toEqual({ read: 0, write: 0, external: 4 });
    expect(entry.toolCount).toBe(0);
    servers[0].owner = 'admin';
    expect((await view()).annotationsTrusted).toBe(true);
  });

  it('never exposes the administrator’s overrides themselves', async () => {
    servers[0].toolRiskOverrides = { 'svc::get': 'external' };
    expect(JSON.stringify(await view())).not.toContain('toolRiskOverrides');
  });
});

describe('services list (added and enabled)', () => {
  const app = buildApp();
  const alice = { 'x-test-user': asUser('alice') };
  const root = { 'x-test-user': asUser('root', true) };
  const row = (username: string, serverName: string) =>
    selectionRows.find((entry) => entry.username === username && entry.serverName === serverName);
  const endpointNames = async (headers: Record<string, string>) =>
    (
      await request(app).get('/api/workspace/endpoints').set(headers).expect(200)
    ).body.data.servers.map((entry: { name: string }) => entry.name);

  beforeEach(() => {
    jest.clearAllMocks();
    selectionRows.length = 0;
    userTools = {};
    liveTools = null;
    groupNames = [];
    clearServerSelectionCache();
    workspaceConfig = { workspace: { enabled: true } };
    mockGetCredentialBindingStatus.mockResolvedValue({ configured: false });
    servers = [
      { name: 'public-tool', owner: 'admin', visibility: 'public', description: 'Shared' },
      { name: 'private-tool', owner: 'admin', visibility: 'private' },
      { name: 'other-tool', owner: 'admin', visibility: 'public' },
    ];
  });

  it('lists every visible service with whether it is added, and adds none by default', async () => {
    const body = (await request(app).get('/api/workspace/servers').set(alice).expect(200)).body;
    expect(body.data.map((entry: any) => [entry.name, entry.added, entry.selected])).toEqual([
      ['public-tool', false, false],
      ['other-tool', false, false],
    ]);
    expect(await endpointNames(alice)).toEqual([]);
  });

  it('adds a service switched on, so the endpoint exposes it, and notifies only that user', async () => {
    await request(app)
      .put('/api/workspace/servers/public-tool/membership')
      .set(alice)
      .send({ added: true })
      .expect(200);
    expect(row('alice', 'public-tool')).toMatchObject({ added: true, selected: true });
    expect(mockNotifyUserListsChanged).toHaveBeenCalledWith('alice');
    expect(await endpointNames(alice)).toEqual(['public-tool']);
  });

  it('exposes a service only while it is both added and enabled', async () => {
    selectionRows.push({
      username: 'alice',
      serverName: 'public-tool',
      added: true,
      selected: false,
      updatedAt: 'x',
    });
    selectionRows.push({
      username: 'alice',
      serverName: 'other-tool',
      added: false,
      selected: true,
      updatedAt: 'x',
    });
    expect(await endpointNames(alice)).toEqual([]);
    await request(app)
      .put('/api/workspace/servers/public-tool/selection')
      .set(alice)
      .send({ selected: true })
      .expect(200);
    expect(await endpointNames(alice)).toEqual(['public-tool']);
  });

  it('removes a service from the list and the endpoint but keeps the permission choice', async () => {
    selectionRows.push({
      username: 'alice',
      serverName: 'public-tool',
      added: true,
      selected: true,
      riskCeiling: 'write',
      updatedAt: 'x',
    });
    await request(app)
      .put('/api/workspace/servers/public-tool/membership')
      .set(alice)
      .send({ added: false })
      .expect(200);
    expect(row('alice', 'public-tool')).toMatchObject({
      added: false,
      selected: false,
      riskCeiling: 'write',
    });
    expect(await endpointNames(alice)).toEqual([]);
  });

  it('keeps what an existing user had switched on, and does not add what they had not', async () => {
    // Rows written before the list existed carry no `added`.
    selectionRows.push({
      username: 'alice',
      serverName: 'public-tool',
      selected: true,
      updatedAt: 'x',
    });
    selectionRows.push({
      username: 'alice',
      serverName: 'other-tool',
      selected: false,
      updatedAt: 'x',
    });
    const body = (await request(app).get('/api/workspace/servers').set(alice).expect(200)).body;
    expect(body.data.map((entry: any) => [entry.name, entry.added, entry.selected])).toEqual([
      ['public-tool', true, true],
      ['other-tool', false, false],
    ]);
    expect(await endpointNames(alice)).toEqual(['public-tool']);
  });

  it('refuses to add a service the user cannot see, without revealing it', async () => {
    await request(app)
      .put('/api/workspace/servers/private-tool/membership')
      .set(alice)
      .send({ added: true })
      .expect(404);
    await request(app)
      .put('/api/workspace/servers/public-tool/membership')
      .set(alice)
      .send({ added: 'yes' })
      .expect(400);
    expect(selectionRows).toEqual([]);
  });

  describe('administrator managing a user', () => {
    const bob = '/api/users/bob/services';

    it('is for administrators only, and only while the workspace is on', async () => {
      await request(app).get(bob).set(alice).expect(403);
      await request(app).put(`${bob}/public-tool`).set(alice).send({ added: true }).expect(403);
      await request(app).get(bob).expect(403);
      expect(selectionRows).toEqual([]);
      workspaceConfig = { workspace: { enabled: false } };
      await request(app).get(bob).set(root).expect(404);
    });

    it('answers 404 for an unknown user', async () => {
      await request(app).get('/api/users/nobody/services').set(root).expect(404);
      await request(app)
        .put('/api/users/nobody/services/public-tool')
        .set(root)
        .send({ added: true })
        .expect(404);
    });

    it('lists what the user can see, not what the administrator can', async () => {
      const body = (await request(app).get(bob).set(root).expect(200)).body;
      expect(body.data.map((entry: any) => [entry.name, entry.added, entry.selected])).toEqual([
        ['public-tool', false, false],
        ['other-tool', false, false],
      ]);
    });

    it('adds a service for the user, switched on, and logs nothing about their secrets', async () => {
      await request(app).put(`${bob}/public-tool`).set(root).send({ added: true }).expect(200);
      expect(row('bob', 'public-tool')).toMatchObject({ added: true, selected: true });
      expect(mockNotifyUserListsChanged).toHaveBeenCalledWith('bob');
      expect(await endpointNames({ 'x-test-user': asUser('bob') })).toEqual(['public-tool']);
      expect(row('alice', 'public-tool')).toBeUndefined();
    });

    it('sets added and enabled separately, and removing switches off', async () => {
      await request(app)
        .put(`${bob}/public-tool`)
        .set(root)
        .send({ added: true, selected: false })
        .expect(200);
      expect(row('bob', 'public-tool')).toMatchObject({ added: true, selected: false });
      await request(app).put(`${bob}/public-tool`).set(root).send({ selected: true }).expect(200);
      expect(row('bob', 'public-tool')).toMatchObject({ added: true, selected: true });
      await request(app).put(`${bob}/public-tool`).set(root).send({ added: false }).expect(200);
      expect(row('bob', 'public-tool')).toMatchObject({ added: false, selected: false });
    });

    it('does not expose a service that is enabled but not added', async () => {
      await request(app).put(`${bob}/public-tool`).set(root).send({ selected: true }).expect(200);
      expect(row('bob', 'public-tool')).toMatchObject({ added: false, selected: true });
      expect(await endpointNames({ 'x-test-user': asUser('bob') })).toEqual([]);
    });

    it('cannot add a service the user cannot see', async () => {
      await request(app).put(`${bob}/private-tool`).set(root).send({ added: true }).expect(404);
      expect(selectionRows).toEqual([]);
    });

    it('rejects a body with nothing valid in it', async () => {
      await request(app).put(`${bob}/public-tool`).set(root).send({}).expect(400);
      await request(app).put(`${bob}/public-tool`).set(root).send({ added: 1 }).expect(400);
    });

    it('lets the user change it afterwards', async () => {
      await request(app).put(`${bob}/public-tool`).set(root).send({ added: true }).expect(200);
      await request(app)
        .put('/api/workspace/servers/public-tool/selection')
        .set({ 'x-test-user': asUser('bob') })
        .send({ selected: false })
        .expect(200);
      expect(row('bob', 'public-tool')).toMatchObject({ added: true, selected: false });
    });
  });
});
