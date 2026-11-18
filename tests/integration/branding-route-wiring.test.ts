jest.mock('openid-client', () => ({}));
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { createAdminToken } from '../utils/testHelpers.js';

const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('px')]);
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
const dataUrl = (mime: string, bytes: Buffer) => `data:${mime};base64,${bytes.toString('base64')}`;

const originalEnv = { ...process.env };

const buildApp = async (basePath: string) => {
  jest.resetModules();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mcphub-branding-wiring-'));
  const settingsPath = path.join(directory, 'settings.json');
  fs.writeFileSync(
    settingsPath,
    JSON.stringify({
      mcpServers: {},
      users: [],
      systemConfig: {
        dashboardBranding: { icon: dataUrl('image/png', png), logoLight: dataUrl('image/svg+xml', svg) },
      },
    }),
  );
  process.env = { ...originalEnv, MCPHUB_SETTING_PATH: settingsPath, USE_DB: 'false', BASE_PATH: basePath };
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

describe.each([['', ''], ['/hub', '/hub']])('branding endpoint wiring (BASE_PATH=%p)', (basePath, prefix) => {
  let app: express.Express;
  let directory: string;

  beforeAll(async () => {
    ({ app, directory } = await buildApp(basePath));
  });
  afterAll(() => fs.rmSync(directory, { recursive: true, force: true }));

  it('serves the three slot names without credentials via GET and HEAD', async () => {
    const get = await request(app).get(`${prefix}/api/branding/icon`);
    expect(get.status).toBe(200);
    expect(get.headers['content-type']).toBe('image/png');
    expect(get.headers['x-content-type-options']).toBe('nosniff');
    expect(get.headers['cache-control']).toBe('no-cache');
    expect(Buffer.from(get.body).equals(png)).toBe(true);

    const svgRes = await request(app).get(`${prefix}/api/branding/logoLight`);
    expect(svgRes.status).toBe(200);
    expect(svgRes.headers['content-security-policy']).toContain('sandbox');

    expect((await request(app).head(`${prefix}/api/branding/icon`)).status).toBe(200);
  });

  it('answers 404 for a configured-but-unset slot and 304 for a matching ETag', async () => {
    expect((await request(app).get(`${prefix}/api/branding/logoDark`)).status).toBe(404);
    const etag = (await request(app).get(`${prefix}/api/branding/icon`)).headers['etag'];
    expect((await request(app).get(`${prefix}/api/branding/icon`).set('If-None-Match', etag)).status).toBe(304);
  });

  it('keeps every other method, name and spelling behind authentication', async () => {
    const blocked = [
      request(app).post(`${prefix}/api/branding/icon`),
      request(app).put(`${prefix}/api/branding/icon`),
      request(app).delete(`${prefix}/api/branding/icon`),
      request(app).get(`${prefix}/api/branding/unknown`),
      request(app).get(`${prefix}/api/branding`),
      request(app).get(`${prefix}/api/branding/%69con`),
      request(app).get(`${prefix}/api/branding/ICON`),
      request(app).get(`${prefix}/api/branding/icon/extra`),
      request(app).get(`${prefix}/api/branding/openapi.json`),
    ];
    for (const pending of blocked) {
      expect((await pending).status).toBe(401);
    }
  });

  it('lets other /api/branding/... paths fall through to their own handlers when authenticated', async () => {
    const token = createAdminToken();
    const res = await request(app)
      .get(`${prefix}/api/branding/openapi.json`)
      .set('Authorization', `Bearer ${token}`);
    expect(JSON.stringify(res.body)).not.toContain('branding image');
    const unknown = await request(app)
      .get(`${prefix}/api/branding/unknown`)
      .set('Authorization', `Bearer ${token}`);
    expect(JSON.stringify(unknown.body)).not.toContain('branding image');
  });
});
