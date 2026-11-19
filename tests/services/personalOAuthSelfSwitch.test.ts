import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  PersonalOAuthContext,
  findPersonalOAuthFlow,
} from '../../src/services/personalOAuthService.js';
import {
  SELF_OAUTH_CLIENT_ID,
  resolveSelfResource,
  resolveSelfResourceStrict,
  SelfResourceUndeterminedError,
  createSelfIssuerFetch,
  resolveSelfResourceForConnection,
} from '../../src/services/selfOAuthResource.js';
import { logger } from '../../src/utils/logger.js';
import type { ServerConfigWithName } from '../../src/types/index.js';

const URL_ = 'https://canvas.example/mcp';
const ISSUER = 'https://hub.example.com';
let definition: ServerConfigWithName;
let systemConfig: Record<string, any>;

jest.mock('../../src/dao/index.js', () => ({
  ...jest.requireActual('../../src/dao/index.js'),
  getSystemConfigDao: () => ({ get: async () => systemConfig }),
}));
const mockRevoke = jest.fn(async () => 1);
jest.mock('../../src/models/OAuth.js', () => ({
  revokeUserClientResourceTokens: (...args: unknown[]) => (mockRevoke as any)(...args),
  findOAuthClientById: async () => null,
}));
jest.mock('../../src/dao/DaoFactory.js', () => ({
  getCredentialBindingDao: () =>
    new (jest.requireActual('../../src/dao/CredentialBindingDao.js').CredentialBindingDaoImpl)(),
  getServerDao: () => ({ findById: async () => definition, findAll: async () => [definition] }),
  getUserDao: () => ({
    findByUsername: async (username: string) => ({ username, isAdmin: false }),
  }),
}));

let directory: string;
const envKeys = ['MCPHUB_SETTING_PATH', 'MCPHUB_CREDENTIAL_ENCRYPTION_KEY'] as const;
const saved = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));
const info = jest.spyOn(logger, 'info').mockImplementation(() => undefined as never);

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mcphub-self-switch-'));
  process.env.MCPHUB_SETTING_PATH = path.join(directory, 'settings.json');
  process.env.MCPHUB_CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  definition = {
    name: 'canvas',
    type: 'streamable-http',
    url: URL_,
    visibility: 'public',
    oauth: { identityMode: 'personal' },
  };
  systemConfig = { install: { baseUrl: ISSUER } };
  mockRevoke.mockClear();
  info.mockClear();
});
afterEach(() => {
  fs.rmSync(directory, { recursive: true, force: true });
  for (const k of envKeys) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const addEntry = () => {
  systemConfig.oauthServer = { externalResources: [{ resource: URL_, name: 'Canvas' }] };
};
const connectUpstream = async (username: string) => {
  const context = await PersonalOAuthContext.load('canvas', username, definition);
  await context.persistClientCredentials('canvas', {
    clientId: 'canvas-dcr-client',
    clientSecret: 'dcr-secret-value',
  });
  await context.persistTokens('canvas', {
    accessToken: 'canvas-access-secret',
    refreshToken: 'canvas-refresh-secret',
  });
  await context.updatePendingAuthorization('canvas', {
    issuer: 'https://canvas.example',
    discoveryState: { authorizationServerUrl: 'https://canvas.example' } as any,
  });
};

const stored = async (username: string) =>
  (await PersonalOAuthContext.load('canvas', username, definition)).config.oauth;
const rawBinding = async (username: string) =>
  (
    await new (jest.requireActual(
      '../../src/dao/CredentialBindingDao.js',
    ).CredentialBindingDaoImpl)().get('canvas', username)
  )?.encryptedValues;

test('load never discards: a foreign binding is left as it is on a plain read', async () => {
  await connectUpstream('alice');
  addEntry();
  const before = await rawBinding('alice');
  const context = await PersonalOAuthContext.load('canvas', 'alice', definition);
  expect(context.config.oauth.clientId).toBe('canvas-dcr-client');
  expect(await rawBinding('alice')).toBe(before);
  expect(info).not.toHaveBeenCalled();
});

test('the user pressing Connect discards the foreign client, grant and pending flow', async () => {
  await connectUpstream('alice');
  addEntry();
  const context = await PersonalOAuthContext.load('canvas', 'alice', definition);
  const self = await resolveSelfResourceStrict(context.config);
  expect(self).toMatchObject({ issuer: ISSUER });
  expect(await context.discardForeignIssuerState(self!.issuer, SELF_OAUTH_CLIENT_ID)).toBe(true);
  const oauth = await stored('alice');
  for (const key of [
    'clientId',
    'clientSecret',
    'accessToken',
    'refreshToken',
    'pendingAuthorization',
  ] as const)
    expect(oauth[key]).toBeUndefined();
  expect(oauth.identityMode).toBe('personal');
  expect(info).toHaveBeenCalledTimes(1);
  const logged = JSON.stringify(info.mock.calls);
  for (const secret of [
    'canvas-dcr-client',
    'dcr-secret-value',
    'canvas-access-secret',
    'canvas-refresh-secret',
  ])
    expect(logged).not.toContain(secret);
  expect(mockRevoke).not.toHaveBeenCalled();
});

test('a genuine self-issued binding is not discarded', async () => {
  addEntry();
  const context = await PersonalOAuthContext.load('canvas', 'alice', definition);
  await context.persistClientCredentials('canvas', { clientId: SELF_OAUTH_CLIENT_ID });
  await context.persistTokens('canvas', { accessToken: 'hub-token' });
  const again = await PersonalOAuthContext.load('canvas', 'alice', definition);
  expect(await again.discardForeignIssuerState(ISSUER, SELF_OAUTH_CLIENT_ID)).toBe(false);
  expect((await stored('alice')).accessToken).toBe('hub-token');
});

test('an administrator-set explicit clientId still opts out of self-resource', async () => {
  definition.oauth = { identityMode: 'personal', clientId: 'admin-client' };
  addEntry();
  const context = await PersonalOAuthContext.load('canvas', 'alice', definition);
  expect(await resolveSelfResource(context.config)).toBeUndefined();
});

test('a stored foreign client id no longer opts out, and is not used as the client', async () => {
  await connectUpstream('alice');
  addEntry();
  const context = await PersonalOAuthContext.load('canvas', 'alice', definition);
  expect(await resolveSelfResource(context.config)).toMatchObject({ issuer: ISSUER });
});

test('a configuration read error is an error, not "not self-resource", and discards nothing', async () => {
  await connectUpstream('alice');
  addEntry();
  const before = await rawBinding('alice');
  const context = await PersonalOAuthContext.load('canvas', 'alice', definition);
  const dao = jest.requireMock('../../src/dao/index.js');
  const original = dao.getSystemConfigDao;
  dao.getSystemConfigDao = () => ({
    get: async () => {
      throw new Error('boom');
    },
  });
  try {
    await expect(resolveSelfResourceStrict(context.config)).rejects.toThrow('boom');
  } finally {
    dao.getSystemConfigDao = original;
  }
  expect(await rawBinding('alice')).toBe(before);
});

const hubIssued = async (username: string) => {
  addEntry();
  const context = await PersonalOAuthContext.load('canvas', username, definition);
  // What the real flow leaves: tokens and the resource, no stored client id.
  await context.mutate(({ oauth }) => {
    oauth.accessToken = 'hub-token';
    oauth.refreshToken = 'hub-refresh-secret';
    oauth.grantResource = URL_;
  });
};
const withConfigReadError = async (action: () => Promise<void>) => {
  const dao = jest.requireMock('../../src/dao/index.js');
  const original = dao.getSystemConfigDao;
  dao.getSystemConfigDao = () => ({
    get: async () => {
      throw new Error('boom');
    },
  });
  try {
    await action();
  } finally {
    dao.getSystemConfigDao = original;
  }
};

test('a hub-issued binding with no stored client id: a config read error at connect is temporary and sends nothing', async () => {
  await hubIssued('bob');
  const before = await rawBinding('bob');
  const context = await PersonalOAuthContext.load('canvas', 'bob', definition);
  const upstream = jest.fn();
  await withConfigReadError(async () => {
    await expect(resolveSelfResourceForConnection('canvas', context.config)).rejects.toBeInstanceOf(
      SelfResourceUndeterminedError,
    );
  });
  expect(upstream).not.toHaveBeenCalled();
  expect(await rawBinding('bob')).toBe(before);
});

test('a hub-issued binding with the entry missing asks to reconnect and changes nothing', async () => {
  await hubIssued('bob');
  delete systemConfig.oauthServer;
  const before = await rawBinding('bob');
  const context = await PersonalOAuthContext.load('canvas', 'bob', definition);
  await expect(resolveSelfResourceForConnection('canvas', context.config)).rejects.toThrow(
    /reconnect/i,
  );
  expect(await rawBinding('bob')).toBe(before);
  expect(mockRevoke).not.toHaveBeenCalled();
});

test("self to non-self: the user's Connect drops the hub grant, then connect resolves; a read error changes nothing", async () => {
  await hubIssued('bob');
  delete systemConfig.oauthServer;
  const before = await rawBinding('bob');
  const context = await PersonalOAuthContext.load('canvas', 'bob', definition);
  await withConfigReadError(async () => {
    await expect(resolveSelfResourceStrict(definition)).rejects.toThrow('boom');
  });
  expect(await rawBinding('bob')).toBe(before);
  // Connect, as the controller does once the strict resolver positively says "not self-resource"
  expect(await resolveSelfResourceStrict(definition)).toBeUndefined();
  expect(await context.discardHubIssuedState(SELF_OAUTH_CLIENT_ID)).toEqual({
    grantResource: URL_,
  });
  const after = await PersonalOAuthContext.load('canvas', 'bob', definition);
  expect(after.config.oauth.accessToken).toBeUndefined();
  expect(after.config.oauth.refreshToken).toBeUndefined();
  expect(after.config.oauth.grantResource).toBeUndefined();
  expect(await resolveSelfResourceForConnection('canvas', after.config)).toBeUndefined();
  expect(JSON.stringify(info.mock.calls)).not.toContain('hub-refresh-secret');
});

test('a foreign (upstream-issued) binding with no entry connects as before', async () => {
  await connectUpstream('alice');
  const context = await PersonalOAuthContext.load('canvas', 'alice', definition);
  expect(await resolveSelfResourceForConnection('canvas', context.config)).toBeUndefined();
});

test('normal self-resource connect resolves, and a refresh only goes to the hub token endpoint', async () => {
  await hubIssued('bob');
  const context = await PersonalOAuthContext.load('canvas', 'bob', definition);
  const self = await resolveSelfResourceForConnection('canvas', context.config);
  expect(self).toMatchObject({ issuer: ISSUER });
  const next = jest.fn(async () => new Response('{}'));
  const fetchFn = createSelfIssuerFetch(self!.issuer, next as any);
  const refresh = {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: 'hub-refresh-secret' }),
  };
  await expect(fetchFn('https://other-as.example/token', refresh)).rejects.toThrow(
    /own token endpoint/,
  );
  expect(next).not.toHaveBeenCalled();
  // other traffic (the upstream resource) still passes through
  await fetchFn(URL_, { method: 'POST', body: '{}' });
  expect(next).toHaveBeenCalledTimes(1);
});

test('an unauthenticated relay lookup of personal.x writes nothing', async () => {
  await connectUpstream('alice');
  addEntry();
  const before = await rawBinding('alice');
  expect(await findPersonalOAuthFlow('personal.guess')).toBeUndefined();
  expect(await rawBinding('alice')).toBe(before);
  expect(info).not.toHaveBeenCalled();
});

test('a concurrent reconnect loses nothing: a stale discard aborts without side effects', async () => {
  await connectUpstream('alice');
  addEntry();
  const first = await PersonalOAuthContext.load('canvas', 'alice', definition);
  const second = await PersonalOAuthContext.load('canvas', 'alice', definition);
  await second.discardForeignIssuerState(ISSUER, SELF_OAUTH_CLIENT_ID);
  await second.persistTokens('canvas', { accessToken: 'new-hub-token' });
  const before = await rawBinding('alice');
  await expect(first.discardForeignIssuerState(ISSUER, SELF_OAUTH_CLIENT_ID)).rejects.toThrow(
    /changed/,
  );
  expect(await rawBinding('alice')).toBe(before);
  expect((await stored('alice')).accessToken).toBe('new-hub-token');
});
