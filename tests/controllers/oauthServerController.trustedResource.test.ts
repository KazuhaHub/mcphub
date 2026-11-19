const mockAuthorize = jest.fn();
let externalResource: Record<string, unknown>;

jest.mock('../../src/services/oauthServerService.js', () => ({
  getOAuthServer: jest.fn(() => ({ authorize: mockAuthorize })),
  handleTokenRequest: jest.fn(),
  handleAuthenticateRequest: jest.fn(),
}));
jest.mock('../../src/models/OAuth.js', () => ({ findOAuthClientById: jest.fn() }));
jest.mock('../../src/services/betterAuthSession.js', () => ({
  resolveBetterAuthUser: jest.fn(async () => null),
}));
jest.mock('../../src/utils/frontendShell.js', () => ({ injectOAuthConsentShell: jest.fn() }));
jest.mock('../../src/utils/userSession.js', () => ({
  getUserSessionVersion: jest.fn(() => 'v1'),
  resolveJwtUser: jest.fn(async (token: string) =>
    token === 'session-jwt' ? { username: 'alice', password: '', isAdmin: false } : null,
  ),
}));
jest.mock('../../src/dao/index.js', () => ({
  getGroupDao: jest.fn(() => ({ findByName: jest.fn().mockResolvedValue(null) })),
  getServerDao: jest.fn(() => ({ findById: jest.fn().mockResolvedValue(null) })),
  getSystemConfigDao: jest.fn(() => ({
    get: async () => ({
      install: { baseUrl: 'https://hub.example.com' },
      oauthServer: { enabled: true, externalResources: [externalResource] },
    }),
  })),
}));
jest.mock('../../src/utils/logger.js', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), log: jest.fn(), debug: jest.fn() },
}));

import { getAuthorize } from '../../src/controllers/oauthServerController.js';
import { findOAuthClientById } from '../../src/models/OAuth.js';
import { injectOAuthConsentShell } from '../../src/utils/frontendShell.js';
import { logger } from '../../src/utils/logger.js';

const RESOURCE = 'https://canvas.example.com/mcp';
const CALLBACK = 'https://hub.example.com/oauth/callback';
const selfQuery = {
  client_id: 'mcphub-personal-oauth',
  redirect_uri: CALLBACK,
  response_type: 'code',
  scope: 'canvas:read',
  state: 'st',
  resource: RESOURCE,
  code_challenge: 'x'.repeat(43),
  code_challenge_method: 'S256',
};
const spaHeaders = { accept: 'application/json', 'x-auth-token': 'session-jwt' };

const makeRes = () => {
  const res: any = {};
  for (const name of ['status', 'json', 'redirect', 'type', 'send']) {
    res[name] = jest.fn().mockReturnValue(res);
  }
  return res;
};
const makeReq = (query: Record<string, unknown> = {}, headers: Record<string, string> = spaHeaders) =>
  ({
    query: { ...selfQuery, ...query },
    body: {},
    headers,
    header: (name: string) => headers[name],
    method: 'GET',
    originalUrl: '/oauth/authorize',
    t: (key: string) => key,
  }) as any;

const registerClient = (clientId: string, redirectUri = CALLBACK) =>
  (findOAuthClientById as jest.Mock).mockResolvedValue({
    clientId,
    name: 'client',
    redirectUris: [redirectUri],
  });

beforeEach(() => {
  jest.clearAllMocks();
  externalResource = {
    resource: RESOURCE,
    name: 'Canvas',
    scopes: ['canvas:read'],
    skipConsentForPersonalConnection: true,
  };
  registerClient('mcphub-personal-oauth');
  (injectOAuthConsentShell as jest.Mock).mockReturnValue('<html>shell</html>');
  mockAuthorize.mockResolvedValue({ authorizationCode: 'code-123' });
});

const expectConsent = (res: any) => {
  expect(mockAuthorize).not.toHaveBeenCalled();
  expect(res.redirect).not.toHaveBeenCalled();
  expect(res.json).not.toHaveBeenCalledWith(expect.objectContaining({ redirect: expect.anything() }));
};

describe('consent for an administrator-trusted resource', () => {
  it('returns the code redirect to the signed-in dashboard session without a consent page', async () => {
    const res = makeRes();
    await getAuthorize(makeReq(), res);

    expect(mockAuthorize).toHaveBeenCalledTimes(1);
    const target = new URL(res.json.mock.calls[0][0].redirect);
    expect(`${target.origin}${target.pathname}`).toBe(CALLBACK);
    expect(target.searchParams.get('code')).toBe('code-123');
    expect(target.searchParams.get('state')).toBe('st');
    expect(target.searchParams.get('iss')).toBe('https://hub.example.com');
    expect(injectOAuthConsentShell).not.toHaveBeenCalled();
  });

  it('audit-logs the auto-approval with user, client, resource and scope', async () => {
    await getAuthorize(makeReq(), makeRes());
    const line = (logger.info as jest.Mock).mock.calls.map((c) => String(c[0])).join('\n');
    expect(line).toContain('consent skipped');
    expect(line).toContain('mcphub-personal-oauth');
    expect(line).toContain('alice');
    expect(line).toContain(RESOURCE);
    expect(line).toContain('canvas:read');
  });

  it('redirects a plain header-authenticated request', async () => {
    const res = makeRes();
    await getAuthorize(makeReq({}, { 'x-auth-token': 'session-jwt' }), res);
    expect(res.redirect).toHaveBeenCalledTimes(1);
    expect(res.redirect.mock.calls[0][0]).toContain('code=code-123');
  });

  it('asks for consent when the entry did not opt in (the default)', async () => {
    delete externalResource.skipConsentForPersonalConnection;
    const res = makeRes();
    await getAuthorize(makeReq(), res);
    expectConsent(res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ resource: expect.anything() }));
  });

  it('asks for consent for any other client, even with the same redirect URI', async () => {
    registerClient('someone-else');
    const res = makeRes();
    await getAuthorize(makeReq({ client_id: 'someone-else' }), res);
    expectConsent(res);
  });

  it('asks for consent for the client when the redirect URI is not its own callback', async () => {
    registerClient('mcphub-personal-oauth', 'https://other.example.com/cb');
    const res = makeRes();
    await getAuthorize(makeReq({ redirect_uri: 'https://other.example.com/cb' }), res);
    expectConsent(res);
  });

  it('asks for consent for a URL-shaped (CIMD) client id', async () => {
    const cimd = 'https://client.example.com/metadata.json';
    externalResource.allowedClients = [cimd];
    registerClient(cimd);
    const res = makeRes();
    await getAuthorize(makeReq({ client_id: cimd }), res);
    expectConsent(res);
  });

  it('asks for consent for a scope beyond the resource configuration', async () => {
    const res = makeRes();
    await getAuthorize(makeReq({ scope: 'canvas:read canvas:write' }), res);
    expectConsent(res);
  });

  it('asks for consent without a state, or when only a token in the URL signs the user in', async () => {
    const noState = makeRes();
    await getAuthorize(makeReq({ state: undefined }), noState);
    expectConsent(noState);

    const urlToken = makeRes();
    await getAuthorize(makeReq({ token: 'session-jwt' }, {}), urlToken);
    expectConsent(urlToken);
    expect(injectOAuthConsentShell).toHaveBeenCalled();
  });

  it('serves the consent shell to a visitor with no session', async () => {
    const res = makeRes();
    await getAuthorize(makeReq({}, {}), res);
    expect(mockAuthorize).not.toHaveBeenCalled();
    expect(res.type).toHaveBeenCalledWith('html');
  });

  it('asks for consent for a resource that is not the configured one', async () => {
    const res = makeRes();
    await getAuthorize(makeReq({ resource: 'https://hub.example.com/mcp' }), res);
    expectConsent(res);
  });
});
