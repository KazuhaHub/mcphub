import express from 'express';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import type { SystemConfig } from '../../src/types/index.js';
import { listenOnLoopback } from '../utils/loopbackServer.js';

// Break-glass admin password sign-in while password login is disabled. The policy resolver, the
// login controller, the public config and the login rate limiter run for real; the user store
// holds real bcrypt hashes.

let storedConfig: SystemConfig = {};

jest.mock('better-auth', () => ({ betterAuth: jest.fn(() => ({ handler: jest.fn() })) }));
jest.mock('better-auth/plugins', () => ({
  genericOAuth: jest.fn(() => ({ id: 'generic-oauth' })),
}));
jest.mock('pg', () => ({ Pool: jest.fn() }));
jest.mock('kysely', () => ({ PostgresDialect: jest.fn() }));

jest.mock('../../src/dao/DaoFactory.js', () => ({
  getSystemConfigDao: jest.fn(() => ({ get: jest.fn(async () => storedConfig) })),
}));

jest.mock('../../src/utils/systemConfigCache.js', () => ({
  getCachedSystemConfig: jest.fn(() => storedConfig),
  isDatabaseModeEnabled: jest.fn(() => true),
}));

const mockVerifyPassword = jest.fn(
  (plain: string, hash: string): Promise<boolean> =>
    jest.requireActual('bcryptjs').compare(plain, hash),
);
const mockUsers: Record<string, { username: string; password: string; isAdmin: boolean }> = {};
jest.mock('../../src/models/User.js', () => ({
  createUser: jest.fn(),
  findUserByUsername: jest.fn(async (username: string) => mockUsers[username]),
  verifyPassword: (plain: string, hash: string) => mockVerifyPassword(plain, hash),
  updateUserPassword: jest.fn(),
}));

jest.mock('../../src/services/services.js', () => ({
  getDataService: jest.fn(() => ({ getPermissions: jest.fn(() => ['']) })),
}));

const ENV = {
  OIDC_CLIENT_ID: 'oidc-client-id',
  OIDC_CLIENT_SECRET: 'oidc-client-secret',
  DB_URL: 'postgresql://mcphub:password@localhost:5432/mcphub',
};

const settings = (betterAuth: { disablePasswordLogin: boolean; adminPasswordLogin?: boolean }) => ({
  auth: {
    betterAuth: {
      enabled: true,
      ...betterAuth,
      providers: {
        oidc: {
          enabled: true,
          discoveryUrl: 'https://auth.example.com/.well-known/openid-configuration',
        },
      },
    },
  },
});

/** A fresh process with the OIDC provider mounted, the real login limiter and the public config. */
// Environment variables the code under test reads. Each test starts from a copy of the worker's
// environment with all of them removed, so nothing a developer or another suite set can leak in
// (src/config and the rate limiter also call dotenv.config(), which only fills unset keys).
const ISOLATED_ENV =
  /^(BETTER_AUTH_|AUTH_RATE_LIMIT_|REGISTER_RATE_LIMIT_|OIDC_|GOOGLE_CLIENT_|GITHUB_CLIENT_|USE_DB$|DB_URL$|BASE_PATH$|INSTALL_BASE_URL$)/;
const isolatedEnv = (base: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(base)) {
    if (!ISOLATED_ENV.test(key)) env[key] = value;
  }
  // The limiter is off under a test runner unless a test turns it on explicitly
  return { ...env, ...ENV, NODE_ENV: 'test', JEST_WORKER_ID: base.JEST_WORKER_ID ?? '1' };
};

/**
 * A fresh process with the OIDC provider mounted, the real POST /auth/login route definition
 * (validators, login limiter, controller) and the public config.
 */
const startProcess = async ({ limited = false } = {}) => {
  jest.resetModules();
  if (limited) {
    // The shared limiters switch themselves off under a test runner
    delete process.env.JEST_WORKER_ID;
    process.env.NODE_ENV = 'production';
    process.env.AUTH_RATE_LIMIT_MAX = '3';
    process.env.AUTH_RATE_LIMIT_WINDOW_MS = '900000';
  }
  const { registeredSsoProviders } = await import('../../src/betterAuth.js');
  const { setMountedSsoProviders } = await import('../../src/services/betterAuthConfig.js');
  setMountedSsoProviders(registeredSsoProviders);
  expect(registeredSsoProviders).toEqual(['oidc']);
  const { mountPasswordLoginRoute } = await import('../../src/routes/passwordLoginRoute.js');
  const { getPublicConfig } = await import('../../src/controllers/configController.js');
  const { logger } = await import('../../src/utils/logger.js');

  const api = express.Router();
  mountPasswordLoginRoute(api);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).t = (key: string) => key;
    next();
  });
  app.use('/api', api);
  app.get('/public-config', getPublicConfig);
  const served = await listenOnLoopback(app);
  openServers.push(served);
  return { app: served.url, logger };
};

const openServers: Array<{ close: () => Promise<void> }> = [];
afterEach(async () => {
  await Promise.all(openServers.splice(0).map((server) => server.close()));
});

const signIn = (app: string, username: string, password: string) =>
  request(app).post('/api/auth/login').send({ username, password });

describe('break-glass admin password sign-in', () => {
  const originalEnv = process.env;

  beforeAll(async () => {
    mockUsers.root = {
      username: 'root',
      password: await bcrypt.hash('root-secret', 10),
      isAdmin: true,
    };
    mockUsers.alice = {
      username: 'alice',
      password: await bcrypt.hash('alice-secret', 10),
      isAdmin: false,
    };
  });

  beforeEach(() => {
    process.env = isolatedEnv(originalEnv);
    mockVerifyPassword.mockClear();
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  describe('with the setting on', () => {
    beforeEach(() => {
      storedConfig = settings({ disablePasswordLogin: true, adminPasswordLogin: true });
    });

    it('accepts an admin and logs the sign-in with username and IP', async () => {
      const { app, logger } = await startProcess();
      const warn = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
      const response = await signIn(app, 'root', 'root-secret');
      expect(response.status).toBe(200);
      expect(response.body.token).toEqual(expect.any(String));
      expect(response.body.user).toMatchObject({ username: 'root', isAdmin: true });
      const line = warn.mock.calls
        .map((args) => String(args[0]))
        .find((m) => m.includes('Break-glass'));
      expect(line).toContain('"root"');
      expect(line).toMatch(/from (::ffff:)?127\.0\.0\.1|from ::1/);
    });

    it('rejects a non-admin with the right password exactly like a wrong password', async () => {
      const { app } = await startProcess();
      const nonAdmin = await signIn(app, 'alice', 'alice-secret');
      const wrongPassword = await signIn(app, 'root', 'not-the-password');
      expect(nonAdmin.status).toBe(403);
      expect(nonAdmin.status).toBe(wrongPassword.status);
      expect(nonAdmin.body).toEqual(wrongPassword.body);
      expect(nonAdmin.body).toEqual({
        success: false,
        message: 'api.errors.password_login_disabled',
      });
    });

    it('rejects an unknown user exactly like a wrong password, after the same bcrypt work', async () => {
      const { app } = await startProcess();
      mockVerifyPassword.mockClear();
      const unknown = await signIn(app, 'mallory', 'whatever');
      const wrongPassword = await signIn(app, 'root', 'not-the-password');
      expect(unknown.status).toBe(wrongPassword.status);
      expect(unknown.body).toEqual(wrongPassword.body);
      // The unknown account is still checked against a hash, so it does not answer faster
      expect(mockVerifyPassword).toHaveBeenCalledTimes(2);
      expect(mockVerifyPassword.mock.calls[0][1]).toMatch(/^\$2[aby]\$10\$/);
    });

    it('rejects a missing password like any other failure', async () => {
      const { app } = await startProcess();
      const response = await request(app).post('/api/auth/login').send({ username: 'root' });
      expect(response.status).toBe(403);
      expect(response.body.message).toBe('api.errors.password_login_disabled');
    });

    it('does not reveal the setting in the public config', async () => {
      const { app } = await startProcess();
      const response = await request(app).get('/public-config');
      expect(response.status).toBe(200);
      expect(response.body.data.betterAuth.disablePasswordLogin).toBe(true);
      expect(JSON.stringify(response.body)).not.toMatch(/adminPasswordLogin/i);

      storedConfig = settings({ disablePasswordLogin: true, adminPasswordLogin: false });
      const off = await request(app).get('/public-config');
      // Byte for byte the same answer either way
      expect(off.body).toEqual(response.body);
    });

    it('counts rejected attempts against the login rate limit', async () => {
      const { app } = await startProcess({ limited: true });
      for (let attempt = 0; attempt < 3; attempt += 1) {
        expect((await signIn(app, 'alice', 'alice-secret')).status).toBe(403);
      }
      // The budget is spent, so even the admin's correct password is refused now
      const blocked = await signIn(app, 'root', 'root-secret');
      expect(blocked.status).toBe(429);
    });
  });

  it('does the same password work for every refusal, with the setting on or off', async () => {
    const attempts: Array<[string, string]> = [
      ['mallory', 'whatever'], // unknown account
      ['alice', 'alice-secret'], // non-admin, right password
      ['root', 'not-the-password'], // admin, wrong password
    ];
    const bcryptCalls: Record<string, number[]> = {};
    for (const adminPasswordLogin of [false, true]) {
      storedConfig = settings({ disablePasswordLogin: true, adminPasswordLogin });
      const { app } = await startProcess();
      const calls: number[] = [];
      for (const [username, password] of attempts) {
        mockVerifyPassword.mockClear();
        const response = await signIn(app, username, password);
        expect(response.status).toBe(403);
        expect(response.body).toEqual({
          success: false,
          message: 'api.errors.password_login_disabled',
        });
        calls.push(mockVerifyPassword.mock.calls.length);
      }
      bcryptCalls[adminPasswordLogin ? 'admins' : 'none'] = calls;
    }
    // One bcrypt comparison per attempt, whatever the setting or the reason
    expect(bcryptCalls.none).toEqual([1, 1, 1]);
    expect(bcryptCalls.admins).toEqual(bcryptCalls.none);
  });

  it('runs the route validators: a blank field is a 400 only while password login is open', async () => {
    storedConfig = settings({ disablePasswordLogin: false });
    let { app } = await startProcess();
    expect((await signIn(app, 'root', '')).status).toBe(400);

    // While it is disabled the refusal comes first, so a blank field reveals nothing either
    storedConfig = settings({ disablePasswordLogin: true, adminPasswordLogin: true });
    ({ app } = await startProcess());
    const blank = await signIn(app, 'root', '');
    expect(blank.status).toBe(403);
    expect(blank.body.message).toBe('api.errors.password_login_disabled');
  });

  it('rejects everyone, admins included, with the setting off, with the same answer', async () => {
    storedConfig = settings({ disablePasswordLogin: true, adminPasswordLogin: false });
    const { app } = await startProcess();
    const admin = await signIn(app, 'root', 'root-secret');
    const nonAdmin = await signIn(app, 'alice', 'alice-secret');
    const unknown = await signIn(app, 'mallory', 'whatever');
    expect(admin.status).toBe(403);
    expect(nonAdmin.body).toEqual(admin.body);
    expect(unknown.body).toEqual(admin.body);
  });

  it('lets BETTER_AUTH_DISABLE_PASSWORD_LOGIN=false re-open password login for everyone', async () => {
    storedConfig = settings({ disablePasswordLogin: true, adminPasswordLogin: true });
    process.env.BETTER_AUTH_DISABLE_PASSWORD_LOGIN = 'false';
    const { app } = await startProcess();
    expect((await signIn(app, 'alice', 'alice-secret')).status).toBe(200);
    expect((await signIn(app, 'root', 'root-secret')).status).toBe(200);
    // Back to the normal answer for a wrong password
    expect((await signIn(app, 'mallory', 'whatever')).status).toBe(401);
  });

  it('lets BETTER_AUTH_DISABLE_PASSWORD_LOGIN=true disable it even when the stored setting does not', async () => {
    storedConfig = settings({ disablePasswordLogin: false, adminPasswordLogin: true });
    process.env.BETTER_AUTH_DISABLE_PASSWORD_LOGIN = 'true';
    const { app } = await startProcess();
    expect((await signIn(app, 'alice', 'alice-secret')).status).toBe(403);
    // The break-glass setting still applies to admins
    expect((await signIn(app, 'root', 'root-secret')).status).toBe(200);
  });

  it('accepts everyone with the right password while password login is not disabled', async () => {
    storedConfig = settings({ disablePasswordLogin: false, adminPasswordLogin: true });
    const { app } = await startProcess();
    expect((await signIn(app, 'alice', 'alice-secret')).status).toBe(200);
    expect((await signIn(app, 'mallory', 'whatever')).status).toBe(401);
  });
});
