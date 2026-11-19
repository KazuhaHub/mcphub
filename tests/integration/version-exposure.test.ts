jest.mock('openid-client', () => ({}));
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { createAdminToken, createUserToken } from '../utils/testHelpers.js';

const MARKER = '9.9.9-test';
const originalEnv = { ...process.env };

const buildApp = async (basePath: string, settings: Record<string, unknown> = {}) => {
  jest.resetModules();
  jest.doMock('../../src/utils/version.js', () => ({ getPackageVersion: () => MARKER }));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mcphub-version-exposure-'));
  const settingsPath = path.join(directory, 'settings.json');
  fs.writeFileSync(
    settingsPath,
    JSON.stringify({ mcpServers: {}, users: [
        { username: 'admin', password: 'unused', isAdmin: true },
        { username: 'alice', password: 'unused', isAdmin: false },
      ], systemConfig: settings }),
  );
  process.env = {
    ...originalEnv,
    MCPHUB_SETTING_PATH: settingsPath,
    USE_DB: 'false',
    BASE_PATH: basePath,
  };
  const { initMiddlewares } = await import('../../src/middlewares/index.js');
  const { initRoutes } = await import('../../src/routes/index.js');
  const app = express();
  initMiddlewares(app);
  await initRoutes(app);
  return { app, directory };
};

afterAll(() => {
  process.env = originalEnv;
});

describe.each([
  ['', ''],
  ['/hub', '/hub'],
])('version exposure (BASE_PATH=%p)', (basePath, prefix) => {
  let app: express.Express;
  let directory: string;

  beforeAll(async () => {
    ({ app, directory } = await buildApp(basePath, { discovery: { enabled: true } }));
  });
  afterAll(() => fs.rmSync(directory, { recursive: true, force: true }));

  const publicPaths = [
    `${prefix}/config`,
    `${prefix}/public-config`,
    `${prefix}/api/openapi.json`,
    `${prefix}/discovery/servers`,
    '/.well-known/mcp-marketplace',
    '/.well-known/openid-configuration',
    '/health',
    '/livez',
    '/readyz',
    '/metrics',
  ];

  it.each(publicPaths)('GET %s carries no version', async (url) => {
    const res = await request(app).get(url);
    expect(JSON.stringify(res.body) + res.text).not.toContain(MARKER);
    expect(JSON.stringify(res.headers)).not.toContain(MARKER);
  });

  it('keeps the runtime config usable without a version field', async () => {
    const res = await request(app).get(`${prefix}/config`).expect(200);
    expect(res.body.data).toEqual(expect.objectContaining({ name: 'mcphub' }));
    expect(res.body.data).not.toHaveProperty('version');
  });

  it('rejects an unauthenticated /api/version', async () => {
    const res = await request(app).get(`${prefix}/api/version`);
    expect(res.status).toBe(401);
    expect(JSON.stringify(res.body) + res.text).not.toContain(MARKER);
  });

  it('refuses /api/version and the update check to a non-admin user', async () => {
    for (const url of [`${prefix}/api/version`, `${prefix}/api/changelog/update-info?currentVersion=1.0.0`]) {
      const res = await request(app).get(url).set('x-auth-token', createUserToken('alice', false));
      expect(res.status).toBe(403);
      expect(JSON.stringify(res.body) + res.text).not.toContain(MARKER);
    }
  });

  it('lets an administrator reach the update check', async () => {
    const res = await request(app)
      .get(`${prefix}/api/changelog/update-info?currentVersion=1.0.0`)
      .set('x-auth-token', createAdminToken());
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(401);
  });

  it('serves the version to an administrator', async () => {
    const res = await request(app)
      .get(`${prefix}/api/version`)
      .set('x-auth-token', createAdminToken());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { version: MARKER } });
  });
});
