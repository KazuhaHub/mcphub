const getSystemConfigMock = jest.fn();

jest.mock('../../src/dao/index.js', () => ({
  getSystemConfigDao: jest.fn(() => ({ get: getSystemConfigMock })),
  getGroupDao: jest.fn(() => ({ findByName: jest.fn().mockResolvedValue(null) })),
  getServerDao: jest.fn(() => ({ findById: jest.fn().mockResolvedValue(null) })),
}));

jest.mock('../../src/services/oauthServerService.js', () => ({
  getOAuthServer: jest.fn(() => ({})),
  handleTokenRequest: jest.fn(),
  handleAuthenticateRequest: jest.fn(),
}));

jest.mock('../../src/models/OAuth.js', () => ({
  findOAuthClientById: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/betterAuthSession.js', () => ({
  resolveBetterAuthUser: jest.fn().mockResolvedValue({ username: 'alice', isAdmin: false }),
}));

jest.mock('../../src/utils/frontendShell.js', () => ({
  injectOAuthConsentShell: jest.fn(() => '<html>shell</html>'),
}));

import express from 'express';
import request from 'supertest';
import { getAuthorize, getMetadata } from '../../src/controllers/oauthServerController.js';
import {
  clearCimdCacheForTesting,
  setCimdDnsLookupForTesting,
  setCimdFetchImplForTesting,
} from '../../src/services/cimdClientService.js';
import { injectOAuthConsentShell } from '../../src/utils/frontendShell.js';

const CLIENT_ID = 'https://client.example.com/oauth/client.json';
const REDIRECT = 'https://client.example.com/callback';

const configure = (cimdEnabled: boolean | undefined) =>
  getSystemConfigMock.mockResolvedValue({
    install: { baseUrl: 'https://hub.example.com' },
    oauthServer: {
      enabled: true,
      ...(cimdEnabled === undefined ? {} : { clientIdMetadata: { enabled: cimdEnabled } }),
    },
  });

describe('CIMD: authorization server metadata', () => {
  const app = express();
  app.get('/.well-known/oauth-authorization-server', getMetadata);

  it.each([true, undefined])(
    'advertises client_id_metadata_document_supported when CIMD is %s (on by default)',
    async (enabled) => {
      configure(enabled);
      const res = await request(app).get('/.well-known/oauth-authorization-server').expect(200);
      expect(res.body.client_id_metadata_document_supported).toBe(true);
    },
  );

  it('advertises it when clientIdMetadata only sets cacheTtlMs', async () => {
    getSystemConfigMock.mockResolvedValue({
      install: { baseUrl: 'https://hub.example.com' },
      oauthServer: { enabled: true, clientIdMetadata: { cacheTtlMs: 60_000 } },
    });
    const res = await request(app).get('/.well-known/oauth-authorization-server').expect(200);
    expect(res.body.client_id_metadata_document_supported).toBe(true);
  });

  it.each([false])('omits the flag when CIMD is explicitly %s', async (enabled) => {
    configure(enabled);
    const res = await request(app).get('/.well-known/oauth-authorization-server').expect(200);
    expect(res.body).not.toHaveProperty('client_id_metadata_document_supported');
  });
});

describe('CIMD: authorize endpoint', () => {
  const app = express();
  app.get('/oauth/authorize', getAuthorize as never);

  const fetchDocument = (doc: Record<string, unknown>) =>
    setCimdFetchImplForTesting(
      jest.fn().mockImplementation(
        async () =>
          new Response(JSON.stringify(doc), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      ) as unknown as typeof fetch,
    );

  const authorize = (clientId: string, redirectUri = REDIRECT) =>
    request(app)
      .get('/oauth/authorize')
      .set('x-auth-token', 'ignored')
      .query({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'read',
        code_challenge: 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG',
        code_challenge_method: 'S256',
      });

  beforeEach(() => {
    jest.clearAllMocks();
    clearCimdCacheForTesting();
    setCimdDnsLookupForTesting(async () => ['93.184.216.34']);
    configure(true);
    fetchDocument({
      client_id: CLIENT_ID,
      client_name: 'Example Client',
      redirect_uris: [REDIRECT],
      logo_uri: 'https://client.example.com/logo.png',
    });
  });

  it.each([
    ['no path', 'https://client.example.com'],
    ['root path', 'https://client.example.com/'],
    ['dot segments', 'https://client.example.com/a/../client.json'],
    ['userinfo', 'https://user@client.example.com/client.json'],
  ])('rejects a client_id with %s as invalid_request without fetching', async (_n, clientId) => {
    const fetchSpy = jest.fn();
    setCimdFetchImplForTesting(fetchSpy as unknown as typeof fetch);
    const res = await authorize(clientId);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects a redirect_uri that is not in the document list', async () => {
    const res = await authorize(CLIENT_ID, 'https://evil.example.com/callback');
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'invalid_request', error_description: 'Invalid redirect_uri' });
    expect(injectOAuthConsentShell).not.toHaveBeenCalled();
  });

  it('rejects a document without client_name as invalid_client', async () => {
    fetchDocument({ client_id: CLIENT_ID, redirect_uris: [REDIRECT] });
    const res = await authorize(CLIENT_ID);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_client');
  });

  it('shows client_name and the client_id host on the consent screen, without the client logo', async () => {
    const res = await authorize(CLIENT_ID);
    expect(res.status).toBe(200);
    const context = (injectOAuthConsentShell as jest.Mock).mock.calls[0][0];
    expect(context.clientName).toBe('Example Client');
    expect(context.client.clientHost).toBe('client.example.com');
    expect(context.client.logoUri).toBeUndefined();
  });
});
