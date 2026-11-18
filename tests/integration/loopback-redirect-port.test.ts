// Loopback redirect_uri port flexibility (RFC 8252 section 7.3) for CIMD and native clients,
// end to end through the real controller, service and oauth2-server library.
import crypto from 'crypto';
import express from 'express';
import request from 'supertest';

const clients = new Map<string, Record<string, unknown>>();
const tokens: Record<string, any>[] = [];

let mockApprovals: Record<string, any>[] = [];
jest.mock('../../src/dao/index.js', () => ({
  // Explicit consent is recorded as an approval (remember-consent); keep it in memory.
  getOAuthApprovalDao: () => ({
    findById: async (id: string) => mockApprovals.find((row) => row.id === id) ?? null,
    findByUsername: async (username: string) =>
      mockApprovals.filter((row) => row.username === username),
    save: async (row: Record<string, any>) => {
      mockApprovals = mockApprovals.filter((existing) => existing.id !== row.id).concat(row);
    },
    deleteByUserAndClient: async (username: string, clientId: string) => {
      mockApprovals = mockApprovals.filter(
        (row) => row.username !== username || row.clientId !== clientId,
      );
    },
    deleteByUsername: async (username: string) => {
      mockApprovals = mockApprovals.filter((row) => row.username !== username);
    },
    deleteByClientId: async (clientId: string) => {
      mockApprovals = mockApprovals.filter((row) => row.clientId !== clientId);
    },
  }),
  getSystemConfigDao: () => ({
    get: async () => ({ oauthServer: { enabled: true, clientIdMetadata: { enabled: true } } }),
  }),
  getOAuthClientDao: () => ({
    findByClientId: async (id: string) => clients.get(id) ?? null,
  }),
  getOAuthTokenDao: () => ({
    create: async (token: Record<string, any>) => {
      tokens.push(token);
      return token;
    },
    findByAccessToken: async (t: string) => tokens.find((x) => x.accessToken === t) ?? null,
    findByRefreshToken: async (t: string) => tokens.find((x) => x.refreshToken === t) ?? null,
    revokeToken: async () => true,
  }),
  getUserDao: () => ({
    findByUsername: async (username: string) => ({ username, password: 'hashed' }),
  }),
  getBearerKeyDao: jest.fn(),
}));

jest.mock('../../src/models/User.js', () => ({
  findUserByUsername: jest.fn(),
  verifyPassword: jest.fn(),
}));

jest.mock('../../src/services/betterAuthSession.js', () => ({
  resolveBetterAuthUser: jest.fn(),
}));

import { postAuthorize, postToken } from '../../src/controllers/oauthServerController.js';
import { getUserSessionVersion } from '../../src/utils/userSession.js';
import { initOAuthServer } from '../../src/services/oauthServerService.js';
import {
  clearCimdCacheForTesting,
  setCimdDnsLookupForTesting,
  setCimdFetchImplForTesting,
} from '../../src/services/cimdClientService.js';

const NATIVE_ID = 'https://native.example.com/client.json';
const WEB_ID = 'https://web.example.com/client.json';
const docs: Record<string, Record<string, unknown>> = {
  [NATIVE_ID]: {
    client_id: NATIVE_ID,
    client_name: 'Native',
    redirect_uris: ['http://127.0.0.1/callback', 'http://localhost/callback', 'http://[::1]/cb'],
  },
  [WEB_ID]: {
    client_id: WEB_ID,
    client_name: 'Web',
    redirect_uris: ['https://web.example.com:8443/cb'],
  },
};

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use((req, _res, next) => {
  (req as any).user = {
    username: 'alice',
    isAdmin: false,
    sessionVersion: getUserSessionVersion({ username: 'alice', password: 'hashed' }),
  };
  next();
});
app.post('/oauth/authorize', postAuthorize);
app.post('/oauth/token', postToken);

const pkcePair = () => {
  const verifier = crypto.randomBytes(32).toString('base64url');
  return { verifier, challenge: crypto.createHash('sha256').update(verifier).digest('base64url') };
};

const authorize = (clientId: string, redirectUri: string, challenge: string) =>
  request(app).post('/oauth/authorize').type('form').send({
    allow: 'true',
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    state: 'xyz',
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });

const codeFrom = (res: request.Response): string => {
  expect(res.status).toBe(302);
  return new URL(res.headers.location).searchParams.get('code') as string;
};

beforeAll(async () => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  await initOAuthServer();
});

beforeEach(() => {
  tokens.length = 0;
  clients.clear();
  clearCimdCacheForTesting();
  setCimdDnsLookupForTesting(async () => ['93.184.216.34']);
  setCimdFetchImplForTesting(((url: string) =>
    Promise.resolve(
      new Response(JSON.stringify(docs[url]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )) as unknown as typeof fetch);
});

afterAll(() => jest.restoreAllMocks());

describe('loopback redirect_uri port flexibility', () => {
  it.each([
    'http://127.0.0.1:54321/callback',
    'http://127.0.0.1/callback',
    'http://localhost:61000/callback',
    'http://[::1]:7777/cb',
  ])('accepts an ephemeral port: %s', async (uri) => {
    const { challenge } = pkcePair();
    const res = await authorize(NATIVE_ID, uri, challenge);
    expect(res.status).toBe(302);
    const location = new URL(res.headers.location);
    expect(location.searchParams.get('error')).toBeNull();
    expect(location.searchParams.get('code')).toBeTruthy();
    expect(`${location.origin}${location.pathname}`).toBe(
      new URL(uri).origin + new URL(uri).pathname,
    );
  });

  it.each([
    ['different path', 'http://127.0.0.1:5000/other'],
    ['different host (localhost vs 127.0.0.1 list)', 'http://127.0.0.2:5000/callback'],
    ['https scheme', 'https://127.0.0.1:5000/callback'],
    ['extra query', 'http://127.0.0.1:5000/callback?x=1'],
    ['userinfo', 'http://evil@127.0.0.1:5000/callback'],
    ['lookalike host', 'http://127.0.0.1.evil.com:5000/callback'],
    ['invalid port', 'http://127.0.0.1:99999/callback'],
  ])('rejects %s', async (_n, uri) => {
    const { challenge } = pkcePair();
    const res = await authorize(NATIVE_ID, uri, challenge);
    expect(res.status).toBe(400);
    expect(res.headers.location).toBeUndefined();
  });

  it('never relaxes the port for non-loopback hosts', async () => {
    const { challenge } = pkcePair();
    expect((await authorize(WEB_ID, 'https://web.example.com:9999/cb', challenge)).status).toBe(
      400,
    );
    expect((await authorize(WEB_ID, 'https://web.example.com/cb', challenge)).status).toBe(400);
    expect((await authorize(WEB_ID, 'https://web.example.com:8443/cb', challenge)).status).toBe(
      302,
    );
  });

  const redeem = (code: string, verifier: string, redirectUri: string) =>
    request(app).post('/oauth/token').type('form').send({
      grant_type: 'authorization_code',
      code,
      client_id: NATIVE_ID,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    });

  it('redeems a code with the exact runtime redirect_uri, port included', async () => {
    const { verifier, challenge } = pkcePair();
    const runtimeUri = 'http://127.0.0.1:54321/callback';
    const code = codeFrom(await authorize(NATIVE_ID, runtimeUri, challenge));
    const ok = await redeem(code, verifier, runtimeUri);
    expect(ok.status).toBe(200);
    expect(ok.body.access_token).toBeTruthy();

    // A CIMD client's issued tokens are usable: refresh works, and the bearer lookup accepts it.
    const refreshed = await request(app).post('/oauth/token').type('form').send({
      grant_type: 'refresh_token',
      refresh_token: ok.body.refresh_token,
      client_id: NATIVE_ID,
    });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.access_token).toBeTruthy();
  });

  it.each([
    ['a different port', 'http://127.0.0.1:54322/callback'],
    ['the registered (portless) form', 'http://127.0.0.1/callback'],
  ])('rejects redeeming a code with %s than the authorize request', async (_n, other) => {
    const { verifier, challenge } = pkcePair();
    const code = codeFrom(await authorize(NATIVE_ID, 'http://127.0.0.1:54321/callback', challenge));
    const res = await redeem(code, verifier, other);
    expect(res.status).toBe(400);
    expect(res.body.access_token).toBeUndefined();
  });

  it('applies to DCR clients registered as native, but not as web', async () => {
    clients.set('native-dcr', {
      clientId: 'native-dcr',
      redirectUris: ['http://127.0.0.1/cb'],
      grants: ['authorization_code'],
      metadata: { application_type: 'native' },
    });
    clients.set('web-dcr', {
      clientId: 'web-dcr',
      redirectUris: ['http://127.0.0.1/cb'],
      grants: ['authorization_code'],
      metadata: { application_type: 'web' },
    });
    const { challenge } = pkcePair();
    expect((await authorize('native-dcr', 'http://127.0.0.1:4000/cb', challenge)).status).toBe(302);
    expect((await authorize('web-dcr', 'http://127.0.0.1:4000/cb', challenge)).status).toBe(400);
  });
});
