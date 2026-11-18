let cimdEnabled = true;
let stored: Record<string, unknown> | undefined;

jest.mock('../../src/utils/systemConfigCache.js', () => ({
  getCachedSystemConfig: () => null,
  setCachedSystemConfig: jest.fn(),
  isDatabaseModeEnabled: () => false,
}));
jest.mock('../../src/services/oauthServerService.js', () => ({ isOAuthServerEnabled: () => true }));
jest.mock('../../src/models/OAuth.js', () => ({ getToken: async () => stored }));
jest.mock('../../src/utils/userSession.js', () => ({
  resolveUserSession: async () => ({ username: 'alice', password: 'x', isAdmin: false }),
}));
jest.mock('../../src/services/cimdClientService.js', () => ({
  ...jest.requireActual('../../src/services/cimdClientService.js'),
  getCimdSettings: async () => ({ enabled: cimdEnabled, cacheTtlMs: 1 }),
}));

import { resolveOAuthGrantFromToken } from '../../src/utils/oauthBearer.js';

const CIMD_ID = 'https://client.example.com/client.json';

beforeEach(() => {
  cimdEnabled = true;
  stored = {
    accessToken: 'tok',
    accessTokenExpiresAt: new Date(Date.now() + 3600_000),
    clientId: CIMD_ID,
    username: 'alice',
    sessionVersion: 'v',
  };
});

describe('OAuth bearer for CIMD clients', () => {
  it('accepts a CIMD client token while CIMD is enabled', async () => {
    await expect(resolveOAuthGrantFromToken('tok')).resolves.toMatchObject({ clientId: CIMD_ID });
  });

  it('refuses a CIMD client token once CIMD is disabled', async () => {
    cimdEnabled = false;
    await expect(resolveOAuthGrantFromToken('tok')).resolves.toBeNull();
  });

  it('is unaffected for registered clients when CIMD is disabled', async () => {
    cimdEnabled = false;
    stored!.clientId = 'registered-client';
    await expect(resolveOAuthGrantFromToken('tok')).resolves.toMatchObject({
      clientId: 'registered-client',
    });
  });

  it('keeps refusing credential-write and external-resource grants', async () => {
    stored!.resource = 'internal-id';
    await expect(resolveOAuthGrantFromToken('tok')).resolves.toBeNull();
  });
});
