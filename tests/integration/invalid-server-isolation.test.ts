jest.mock('openid-client', () => ({}));
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JsonFileDaoFactory, setDaoFactory } from '../../src/dao/DaoFactory.js';
import { clearSettingsCache } from '../../src/config/index.js';
import { cleanupAllServers, initializeClientsFromSettings } from '../../src/services/mcpService.js';
import type { McpSettings } from '../../src/types/index.js';

jest.mock('../../src/services/oauthService.js', () => ({ initializeAllOAuthClients: jest.fn() }));
jest.mock('../../src/services/vectorSearchService.js', () => ({
  removeServerToolEmbeddings: jest.fn(),
  removeToolEmbeddings: jest.fn(),
  saveToolsAsVectorEmbeddings: jest.fn(),
  syncAllServerToolsEmbeddings: jest.fn(),
}));
jest.mock('../../src/services/mcpOAuthProvider.js', () => ({ createOAuthProvider: jest.fn() }));
jest.mock('../../src/services/betterAuthConfig.js', () => ({
  getBetterAuthRuntimeConfig: jest.fn(async () => ({ enabled: false })),
}));

let directory: string;
const originalEnv = { path: process.env.MCPHUB_SETTING_PATH, useDb: process.env.USE_DB };

const personal = (slot: Record<string, unknown>) => ({
  type: 'stdio' as const,
  command: 'node',
  args: ['server.js'],
  owner: 'admin',
  visibility: 'public' as const,
  credentialTemplate: [slot],
});

beforeAll(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mcphub-invalid-server-'));
  process.env.MCPHUB_SETTING_PATH = path.join(directory, 'mcp_settings.json');
  process.env.USE_DB = 'false';
  const settings = {
    mcpServers: {
      // An extra key on a slot is rejected by validateCredentialTemplate.
      broken: personal({ target: 'env', name: 'API_KEY', secret: true }),
      healthy: personal({ target: 'env', name: 'API_KEY' }),
    },
    users: [],
    groups: [],
  } as unknown as McpSettings;
  fs.writeFileSync(process.env.MCPHUB_SETTING_PATH, JSON.stringify(settings));
  clearSettingsCache();
  JsonFileDaoFactory.getInstance().resetInstances();
  setDaoFactory(JsonFileDaoFactory.getInstance());
});

afterAll(() => {
  cleanupAllServers();
  fs.rmSync(directory, { recursive: true, force: true });
  for (const [name, value] of Object.entries({
    MCPHUB_SETTING_PATH: originalEnv.path,
    USE_DB: originalEnv.useDb,
  })) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  clearSettingsCache();
  JsonFileDaoFactory.getInstance().resetInstances();
});

it('lists an invalid declaration with its error and still initializes every other server', async () => {
  const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    const infos = await initializeClientsFromSettings(true);
    const broken = infos.find((info) => info.name === 'broken');
    const healthy = infos.find((info) => info.name === 'healthy');

    expect(broken).toMatchObject({ status: 'disconnected', tools: [] });
    expect(broken?.error).toMatch(/^Invalid configuration: Invalid credential slot/);
    // Never started, and nothing a runtime could be built from.
    expect(broken?.config).toBeUndefined();

    expect(healthy).toMatchObject({ status: 'disconnected', error: null, enabled: true });
    expect(healthy?.config?.credentialTemplate).toEqual([{ target: 'env', name: 'API_KEY' }]);
  } finally {
    errors.mockRestore();
  }
});
