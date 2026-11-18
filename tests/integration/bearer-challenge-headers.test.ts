jest.mock('openid-client', () => ({}));
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { clearSettingsCache } from '../../src/config/index.js';
import { JsonFileDaoFactory, setDaoFactory } from '../../src/dao/DaoFactory.js';
import { smartRoutingPathMiddleware } from '../../src/utils/smartRoutingPath.js';
import { sseUserContextMiddleware } from '../../src/middlewares/userContext.js';
import {
  handleMcpOtherRequest,
  handleMcpPostRequest,
  handleSseConnection,
  handleSseMessage,
} from '../../src/services/sseService.js';
import { getProtectedResourceMetadata } from '../../src/controllers/oauthServerController.js';
import type { McpSettings } from '../../src/types/index.js';

jest.mock('../../src/services/mcpService.js', () => ({
  deleteMcpServer: jest.fn(),
  getMcpServer: jest.fn(),
}));

const originalEnv = {
  MCPHUB_SETTING_PATH: process.env.MCPHUB_SETTING_PATH,
  USE_DB: process.env.USE_DB,
  INSTALL_BASE_URL: process.env.INSTALL_BASE_URL,
};
let directory: string;
let app: express.Express;

const METADATA_PREFIX = 'https://hub.example/.well-known/oauth-protected-resource';

beforeAll(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mcphub-challenge-'));
  process.env.MCPHUB_SETTING_PATH = path.join(directory, 'settings.json');
  process.env.USE_DB = 'false';
  delete process.env.INSTALL_BASE_URL;
  const settings: McpSettings = {
    mcpServers: {},
    groups: [],
    users: [
      { username: 'alice', password: 'x', isAdmin: false },
      { username: 'bob', password: 'x', isAdmin: false },
    ],
    bearerKeys: [
      {
        id: 'alice-key',
        name: 'alice-key',
        token: 'alice-token',
        enabled: true,
        kind: 'user',
        owner: 'alice',
        accessType: 'all',
      },
    ],
    systemConfig: {
      install: { baseUrl: 'https://hub.example' },
      routing: {
        enableGlobalRoute: true,
        enableGroupNameRoute: true,
        enableBearerAuth: true,
        skipAuth: false,
        allowTokenInQuery: false,
      },
      oauthServer: { enabled: true, allowedScopes: ['read', 'write', 'offline_access'] },
    },
  };
  fs.writeFileSync(process.env.MCPHUB_SETTING_PATH, JSON.stringify(settings));
  clearSettingsCache();
  JsonFileDaoFactory.getInstance().resetInstances();
  setDaoFactory(JsonFileDaoFactory.getInstance());

  app = express();
  app.use(express.json());
  app.get('/.well-known/oauth-protected-resource', getProtectedResourceMetadata);
  const chain = [smartRoutingPathMiddleware, sseUserContextMiddleware];
  app.get('/sse/:group(.*)?', ...chain, (req, res) => handleSseConnection(req, res));
  app.post('/messages', sseUserContextMiddleware, handleSseMessage);
  app.post('/mcp/:group(.*)?', ...chain, handleMcpPostRequest);
  app.get('/mcp/:group(.*)?', ...chain, handleMcpOtherRequest);
  app.delete('/mcp/:group(.*)?', ...chain, handleMcpOtherRequest);
  app.get('/:user/sse/:group(.*)?', ...chain, (req, res) => handleSseConnection(req, res));
  app.post('/:user/messages', sseUserContextMiddleware, handleSseMessage);
  app.post('/:user/mcp/:group(.*)?', ...chain, handleMcpPostRequest);
  app.get('/:user/mcp/:group(.*)?', ...chain, handleMcpOtherRequest);
});

afterAll(() => {
  fs.rmSync(directory, { recursive: true, force: true });
  for (const [name, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  clearSettingsCache();
  JsonFileDaoFactory.getInstance().resetInstances();
});

const entryPoints: Array<[string, 'get' | 'post' | 'delete', string, string]> = [
  ['streamable POST', 'post', '/mcp', '/mcp'],
  ['streamable GET', 'get', '/mcp', '/mcp'],
  ['streamable DELETE', 'delete', '/mcp', '/mcp'],
  ['group streamable', 'post', '/mcp/team', '/mcp/team'],
  ['smart-routing alias', 'post', '/mcp/$smart', '/mcp/$smart'],
  ['SSE', 'get', '/sse', '/sse'],
  ['SSE group', 'get', '/sse/team', '/sse/team'],
  ['SSE messages', 'post', '/messages', '/messages'],
  ['user streamable POST', 'post', '/alice/mcp', '/alice/mcp'],
  ['user streamable GET', 'get', '/alice/mcp', '/alice/mcp'],
  ['user SSE', 'get', '/alice/sse', '/alice/sse'],
  ['user messages', 'post', '/alice/messages', '/alice/messages'],
];

describe.each(entryPoints)('%s', (_label, method, route, resourcePath) => {
  it('challenges a request with no credentials without an error code', async () => {
    const res = await request(app)[method](route).send({}).expect(401);
    expect(res.headers['www-authenticate']).toBe(
      `Bearer resource_metadata="${METADATA_PREFIX}${resourcePath}", scope="read write"`,
    );
    expect(res.headers['www-authenticate']).not.toContain('offline_access');
  });

  it('keeps invalid_token for a token that does not authenticate', async () => {
    const agent = request(app);
    const res = await agent[method](route).set('Authorization', 'Bearer nope').send({}).expect(401);
    expect(res.headers['www-authenticate']).toBe(
      `Bearer error="invalid_token", error_description="Invalid bearer token", resource_metadata="${METADATA_PREFIX}${resourcePath}", scope="read write"`,
    );
    expect(res.body).toMatchObject({
      error: 'invalid_token',
      error_description: 'Invalid bearer token',
      resource_metadata: `${METADATA_PREFIX}${resourcePath}`,
      scope: 'read write',
    });
  });
});

it('keeps the JSON body shape of the unauthenticated 401 backwards compatible', async () => {
  const res = await request(app).post('/mcp').send({}).expect(401);
  expect(res.body).toEqual({
    error: 'invalid_token',
    error_description: 'No authorization provided',
    resource_metadata: `${METADATA_PREFIX}/mcp`,
    scope: 'read write',
  });
});

it('answers a credential in the query with a challenge on user routes too', async () => {
  const res = await request(app).get('/alice/mcp?access_token=abc').expect(401);
  expect(res.headers['www-authenticate']).toMatch(/^Bearer error="invalid_token", /);
  expect(res.headers['www-authenticate']).toContain('scope="read write"');
});

it('advertises the same scopes in the challenge and the protected resource metadata', async () => {
  const challenge = await request(app).post('/mcp').send({}).expect(401);
  const scope = challenge.headers['www-authenticate'].match(/scope="([^"]+)"/)![1];
  const metadata = await request(app)
    .get('/.well-known/oauth-protected-resource')
    .set('Host', 'hub.example')
    .expect(200);
  expect(metadata.body.scopes_supported).toEqual(scope.split(' '));
});

it('does not attach a challenge to the owner-mismatch 403', async () => {
  const res = await request(app)
    .post('/bob/mcp')
    .set('Authorization', 'Bearer alice-token')
    .send({})
    .expect(403);
  expect(res.headers['www-authenticate']).toBeUndefined();
  expect(res.body.error).toBe('forbidden');
});
