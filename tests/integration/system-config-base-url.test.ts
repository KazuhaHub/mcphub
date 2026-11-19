import express from 'express';
import request from 'supertest';

const signingKeyRows = [{ kid: 'k1', privateKey: 'enc:v1.SECRET-PRIVATE-MATERIAL' }];

// The real file-backed DAO, so what is asserted is what lands in mcp_settings.json.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const systemConfigDao = new (require('../../src/dao/SystemConfigDao.js').SystemConfigDaoImpl)();
const emptyDao = { findAll: async () => [], getAll: async () => [], findEnabled: async () => [] };

jest.mock('../../src/dao/index.js', () => ({
  getUserDao: () => ({
    findByUsername: async (username: string) => ({
      username,
      password: 'unused',
      isAdmin: username === 'admin',
    }),
    findAll: async () => [],
  }),
  getSystemConfigDao: () => systemConfigDao,
  getBearerKeyDao: () => emptyDao,
  getOAuthTokenDao: () => emptyDao,
  getOAuthClientDao: () => emptyDao,
  getServerDao: () => emptyDao,
  getGroupDao: () => emptyDao,
  getUserConfigDao: () => emptyDao,
}));
jest.mock('../../src/dao/DaoFactory.js', () => ({
  getSystemConfigDao: () => systemConfigDao,
  getBearerKeyDao: () => emptyDao,
  getOAuthTokenDao: () => emptyDao,
  getOAuthClientDao: () => emptyDao,
  getServerDao: () => emptyDao,
  getGroupDao: () => emptyDao,
  getUserConfigDao: () => emptyDao,
  getUserDao: () => emptyDao,
}));
jest.mock('../../src/utils/systemConfigCache.js', () => ({
  getCachedSystemConfig: jest.fn(() => null),
  setCachedSystemConfig: jest.fn(),
  isDatabaseModeEnabled: () => false,
}));
jest.mock('../../src/services/oauthServerService.js', () => ({
  isOAuthServerEnabled: jest.fn(() => false),
}));
jest.mock('../../src/services/betterAuthConfig.js', () => ({
  getBetterAuthRuntimeConfig: jest.fn().mockResolvedValue({ enabled: false }),
}));
jest.mock('../../src/services/mcpService.js', () => ({
  getServersInfo: jest.fn(),
  getServerByName: jest.fn(),
  notifyToolChanged: jest.fn(),
}));
jest.mock('../../src/services/vectorSearchService.js', () => ({}));
jest.mock('../../src/services/upstreamOAuthDisconnectService.js', () => ({}));
jest.mock('../../src/services/logService.js', () => ({
  default: { getLogs: jest.fn(), clearLogs: jest.fn(), subscribeToStream: jest.fn() },
}));
jest.mock('../../src/db/connection.js', () => ({
  getAppDataSource: () => ({
    getRepository: () => ({ find: async () => signingKeyRows }),
  }),
}));

import { auth } from '../../src/middlewares/auth.js';
import { authenticatedRouteRateLimiter } from '../../src/utils/rateLimit.js';
import { updateSystemConfig } from '../../src/controllers/serverController.js';
import { getMcpSettingsJson } from '../../src/controllers/configController.js';
import { createAdminToken, createUserToken } from '../utils/testHelpers.js';

import fs from 'fs';
import os from 'os';
import path from 'path';

describe('partial PUT /api/system-config and install.baseUrl', () => {
  let app: express.Application;
  let tmpDir: string;
  let settingsPath: string;
  const saved = {
    setting: process.env.MCPHUB_SETTING_PATH,
    base: process.env.INSTALL_BASE_URL,
  };

  const readStored = () => JSON.parse(fs.readFileSync(settingsPath, 'utf8')).systemConfig;
  const put = (body: unknown) =>
    request(app)
      .put('/api/system-config')
      .set('x-auth-token', createAdminToken())
      .send(body as object);

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcphub-base-url-'));
    settingsPath = path.join(tmpDir, 'mcp_settings.json');
    process.env.MCPHUB_SETTING_PATH = settingsPath;
    process.env.INSTALL_BASE_URL = 'http://127.0.0.1:18083';
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({ mcpServers: {}, systemConfig: { oauthServer: { enabled: true } } }),
    );
    app = express();
    app.use(express.json());
    app.put('/api/system-config', authenticatedRouteRateLimiter, auth, updateSystemConfig);
    app.get('/api/settings', authenticatedRouteRateLimiter, auth, getMcpSettingsJson);
  });

  afterEach(() => {
    for (const [key, value] of [
      ['MCPHUB_SETTING_PATH', saved.setting],
      ['INSTALL_BASE_URL', saved.base],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('does not write a base URL when the update does not mention install', async () => {
    const response = await put({ oauthServer: { allowedScopes: ['read', 'write'] } });
    expect(response.status).toBe(200);
    expect(readStored().install?.baseUrl || '').toBe('');
    expect(response.body.data.install?.baseUrl || '').toBe('');
  });

  it('keeps INSTALL_BASE_URL as the resolved value after a settings read and a partial update', async () => {
    await request(app).get('/api/settings').set('x-auth-token', createAdminToken());
    await put({ oauthServer: { allowedScopes: ['read', 'write'] } });
    expect(readStored().install?.baseUrl || '').toBe('');
  });

  it('keeps a stored base URL when another section is updated', async () => {
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        mcpServers: {},
        systemConfig: { install: { baseUrl: 'https://hub.example.com' } },
      }),
    );
    await put({ routing: { skipAuth: false } });
    expect(readStored().install.baseUrl).toBe('https://hub.example.com');
  });
});
