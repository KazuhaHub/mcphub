import { getSystemConfigDao } from '../../src/dao/index.js';
import {
  clearCimdCacheForTesting,
  computeCimdCacheTtlMs,
  getCimdClientHost,
  validateCimdClientIdUrl,
  getCimdSettings,
  isCimdClientId,
  mapCimdDocument,
  resolveCimdClient,
  setCimdDnsLookupForTesting,
  setCimdFetchImplForTesting,
} from '../../src/services/cimdClientService.js';

jest.mock('../../src/models/OAuth.js', () => ({
  findOAuthClientById: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/dao/index.js', () => ({
  getSystemConfigDao: jest.fn(),
}));

const mockedGetSystemConfigDao = getSystemConfigDao as jest.Mock;

const configureCimd = (enabled: boolean, cacheTtlMs?: number) => {
  mockedGetSystemConfigDao.mockReturnValue({
    get: async () => ({
      oauthServer: {
        clientIdMetadata: { enabled, ...(cacheTtlMs !== undefined ? { cacheTtlMs } : {}) },
      },
    }),
  });
};

const validDoc = (url: string) => ({
  client_id: url,
  client_name: 'Test Client',
  redirect_uris: ['https://app.example.com/callback'],
});

const jsonResponse = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });

describe('cimdClientService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearCimdCacheForTesting();
    // Public, non-blocked address so the SSRF guard never performs real DNS.
    setCimdDnsLookupForTesting(async () => ['93.184.216.34']);
  });

  describe('isCimdClientId', () => {
    it('accepts only HTTPS URL identifiers', () => {
      expect(isCimdClientId('https://client.example.com/metadata')).toBe(true);
      expect(isCimdClientId('http://client.example.com/metadata')).toBe(false);
      expect(isCimdClientId('registered-client-id')).toBe(false);
    });
  });

  describe('getCimdSettings', () => {
    it('is disabled by default', async () => {
      configureCimd(false);
      expect(await getCimdSettings()).toEqual({ enabled: false, cacheTtlMs: 3_600_000 });
    });

    it('fails closed when the config store errors', async () => {
      mockedGetSystemConfigDao.mockImplementation(() => {
        throw new Error('dao unavailable');
      });
      expect((await getCimdSettings()).enabled).toBe(false);
    });
  });

  describe('mapCimdDocument', () => {
    const url = 'https://client.example.com/oauth-metadata';

    it('maps a valid public-client document', () => {
      const client = mapCimdDocument(url, {
        client_id: url,
        client_name: 'Example Client',
        redirect_uris: ['https://app.example.com/callback', 'http://127.0.0.1/callback'],
        application_type: 'native',
        contacts: ['dev@example.com'],
        policy_uri: 'https://app.example.com/policy',
      });

      expect(client).toMatchObject({
        clientId: url,
        name: 'Example Client',
        grants: ['authorization_code', 'refresh_token'],
        redirectUris: ['https://app.example.com/callback', 'http://127.0.0.1/callback'],
      });
      expect(client?.metadata?.application_type).toBe('native');
      expect(client?.clientSecret).toBeUndefined();
    });

    it('rejects documents whose client_id does not match the fetch URL', () => {
      expect(
        mapCimdDocument(url, {
          client_id: 'https://other.example.com/metadata',
          client_name: 'X',
          redirect_uris: ['https://app.example.com/callback'],
        }),
      ).toBeUndefined();
    });

    it('rejects documents without redirect URIs', () => {
      expect(mapCimdDocument(url, { client_id: url, client_name: 'X' })).toBeUndefined();
      expect(
        mapCimdDocument(url, { client_id: url, client_name: 'X', redirect_uris: [] }),
      ).toBeUndefined();
    });

    it('rejects documents claiming secret-based authentication', () => {
      expect(
        mapCimdDocument(url, {
          client_id: url,
          client_name: 'X',
          redirect_uris: ['https://app.example.com/callback'],
          token_endpoint_auth_method: 'client_secret_basic',
        }),
      ).toBeUndefined();
    });

    it('requires a non-empty client_name', () => {
      expect(
        mapCimdDocument(url, { client_id: url, redirect_uris: ['https://a.example.com/cb'] }),
      ).toBeUndefined();
      expect(
        mapCimdDocument(url, {
          client_id: url,
          client_name: '  ',
          redirect_uris: ['https://a.example.com/cb'],
        }),
      ).toBeUndefined();
    });

    const base = () => ({
      client_id: url,
      client_name: 'X',
      redirect_uris: ['https://a.example.com/cb'],
    });

    it.each([
      ['client_secret', { client_secret: 's' }],
      ['client_secret_expires_at', { client_secret_expires_at: 0 }],
      ['jwks and jwks_uri together', { jwks: { keys: [] }, jwks_uri: 'https://a.example.com/j' }],
      ['non-string redirect_uris entries', { redirect_uris: [1] }],
      ['javascript: redirect', { redirect_uris: ['javascript:alert(1)'] }],
      ['redirect with fragment', { redirect_uris: ['https://a.example.com/cb#x'] }],
      ['only shared-secret methods', { token_endpoint_auth_methods_supported: ['client_secret_post'] }],
      ['singular not in plural list', {
        token_endpoint_auth_method: 'none',
        token_endpoint_auth_methods_supported: ['private_key_jwt'],
      }],
      ['no supported grant type', { grant_types: ['client_credentials'] }],
      ['no supported response type', { response_types: ['token'] }],
    ])('rejects %s', (_name, extra) => {
      expect(mapCimdDocument(url, { ...base(), ...extra } as never)).toBeUndefined();
    });

    it('accepts none in the plural auth-method list and overlapping grant types', () => {
      expect(
        mapCimdDocument(url, {
          ...base(),
          token_endpoint_auth_methods_supported: ['none'],
          grant_types: ['authorization_code', 'client_credentials'],
          response_types: ['code'],
        }),
      ).toBeDefined();
    });

    it('rejects non-object payloads', () => {
      expect(mapCimdDocument(url, undefined as never)).toBeUndefined();
      expect(mapCimdDocument(url, ['not', 'an', 'object'] as never)).toBeUndefined();
    });
  });

  describe('resolveCimdClient', () => {
    const url = 'https://client.example.com/oauth-metadata';

    it('returns undefined when disabled even for URL-shaped ids', async () => {
      configureCimd(false);
      await expect(resolveCimdClient(url)).resolves.toBeUndefined();
    });

    it('fetches and caches a valid metadata document', async () => {
      configureCimd(true);
      const fetchMock = jest.fn().mockResolvedValue(
        jsonResponse({
          client_id: url,
          client_name: 'Cached Client',
          redirect_uris: ['https://app.example.com/callback'],
        }),
      );
      setCimdFetchImplForTesting(fetchMock as unknown as typeof fetch);

      const first = await resolveCimdClient(url);
      expect(first?.name).toBe('Cached Client');
      const second = await resolveCimdClient(url);
      expect(second).toBe(first);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('refetches after the cache TTL expires', async () => {
      configureCimd(true, 60_000);
      const fetchMock = jest.fn().mockImplementation(async () => jsonResponse(validDoc(url)));
      setCimdFetchImplForTesting(fetchMock as unknown as typeof fetch);
      const realNow = Date.now();
      const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(realNow);
      try {
        await resolveCimdClient(url);
        nowSpy.mockReturnValue(realNow + 59_000);
        await resolveCimdClient(url);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        nowSpy.mockReturnValue(realNow + 61_000);
        await resolveCimdClient(url);
        expect(fetchMock).toHaveBeenCalledTimes(2);
      } finally {
        nowSpy.mockRestore();
      }
    });

    it('does not cache a response with Cache-Control: no-store', async () => {
      configureCimd(true);
      const fetchMock = jest.fn().mockImplementation(async () =>
        jsonResponse(validDoc(url), { headers: { 'cache-control': 'no-store' } }),
      );
      setCimdFetchImplForTesting(fetchMock as unknown as typeof fetch);
      expect((await resolveCimdClient(url))?.name).toBe('Test Client');
      await resolveCimdClient(url);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('honours a short Cache-Control max-age below the configured TTL', async () => {
      configureCimd(true, 3_600_000);
      const fetchMock = jest.fn().mockImplementation(async () =>
        jsonResponse(validDoc(url), { headers: { 'cache-control': 'max-age=40' } }),
      );
      setCimdFetchImplForTesting(fetchMock as unknown as typeof fetch);
      const realNow = Date.now();
      const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(realNow);
      try {
        await resolveCimdClient(url);
        nowSpy.mockReturnValue(realNow + 41_000);
        await resolveCimdClient(url);
        expect(fetchMock).toHaveBeenCalledTimes(2);
      } finally {
        nowSpy.mockRestore();
      }
    });

    it('does not cache failed fetches or invalid documents', async () => {
      configureCimd(true);
      const fetchMock = jest
        .fn()
        .mockResolvedValueOnce(new Response('nope', { status: 500 }))
        .mockResolvedValueOnce(jsonResponse({ client_id: url }))
        .mockImplementation(async () => jsonResponse(validDoc(url)));
      setCimdFetchImplForTesting(fetchMock as unknown as typeof fetch);
      expect(await resolveCimdClient(url)).toBeUndefined();
      expect(await resolveCimdClient(url)).toBeUndefined();
      expect((await resolveCimdClient(url))?.name).toBe('Test Client');
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('treats redirects as failures and never follows them', async () => {
      configureCimd(true);
      const fetchMock = jest.fn().mockResolvedValue(
        new Response(null, { status: 302, headers: { location: 'https://evil.example.com/x' } }),
      );
      setCimdFetchImplForTesting(fetchMock as unknown as typeof fetch);
      expect(await resolveCimdClient(url)).toBeUndefined();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('rejects non-200 success statuses and oversized documents', async () => {
      configureCimd(true);
      setCimdFetchImplForTesting(
        jest.fn().mockResolvedValue(jsonResponse(validDoc(url), { status: 203 })) as never,
      );
      expect(await resolveCimdClient(url)).toBeUndefined();
      clearCimdCacheForTesting();
      setCimdFetchImplForTesting(
        jest
          .fn()
          .mockResolvedValue(
            jsonResponse({ ...validDoc(url), padding: 'x'.repeat(20_000) }),
          ) as never,
      );
      expect(await resolveCimdClient(url)).toBeUndefined();
    });

    it('does not fetch malformed URL-shaped client_ids', async () => {
      configureCimd(true);
      const fetchMock = jest.fn();
      setCimdFetchImplForTesting(fetchMock as unknown as typeof fetch);
      for (const bad of [
        'https://client.example.com/',
        'https://client.example.com',
        'https://client.example.com/a/../b',
        'https://client.example.com/a#frag',
        'https://user@client.example.com/meta',
      ]) {
        expect(await resolveCimdClient(bad)).toBeUndefined();
      }
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('does not resolve invalid documents', async () => {
      configureCimd(true);
      setCimdFetchImplForTesting(
        jest.fn().mockResolvedValue(jsonResponse({ client_id: url })) as unknown as typeof fetch,
      );
      await expect(resolveCimdClient(url)).resolves.toBeUndefined();
    });

    it('blocks SSRF targets before fetching', async () => {
      configureCimd(true);
      const fetchMock = jest.fn();
      setCimdFetchImplForTesting(fetchMock as unknown as typeof fetch);

      await expect(
        resolveCimdClient('https://127.0.0.1/metadata.json'),
      ).resolves.toBeUndefined();
      await expect(resolveCimdClient('http://169.254.169.254/latest/meta-data')).resolves.toBeUndefined();
      await expect(resolveCimdClient('https://10.0.0.5/metadata.json')).resolves.toBeUndefined();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('returns undefined on network failures without throwing', async () => {
      configureCimd(true);
      setCimdFetchImplForTesting(
        jest.fn().mockRejectedValue(new Error('boom')) as unknown as typeof fetch,
      );
      await expect(resolveCimdClient(url)).resolves.toBeUndefined();
    });
  });
});

describe('validateCimdClientIdUrl', () => {
  it('accepts well-formed identifiers', () => {
    expect(validateCimdClientIdUrl('https://app.example.com/client.json')).toBeUndefined();
    expect(validateCimdClientIdUrl('https://app.example.com:8443/a/b?x=1')).toBeUndefined();
  });

  it.each([
    ['http scheme', 'http://app.example.com/client.json'],
    ['no path', 'https://app.example.com'],
    ['root path only', 'https://app.example.com/'],
    ['query without path', 'https://app.example.com?x=1'],
    ['fragment', 'https://app.example.com/client.json#frag'],
    ['userinfo', 'https://user:pw@app.example.com/client.json'],
    ['dot segment', 'https://app.example.com/a/./client.json'],
    ['dot-dot segment', 'https://app.example.com/a/../client.json'],
    ['encoded dot-dot segment', 'https://app.example.com/a/%2e%2e/client.json'],
    ['whitespace', 'https://app.example.com/a b'],
    ['backslash', 'https://app.example.com\\evil.com/x'],
    ['too long', `https://app.example.com/${'a'.repeat(3000)}`],
  ])('rejects %s', (_name, value) => {
    expect(validateCimdClientIdUrl(value)).toEqual(expect.any(String));
  });
});

describe('getCimdClientHost', () => {
  it('returns the host for CIMD ids only', () => {
    expect(getCimdClientHost('https://app.example.com:8443/c.json')).toBe('app.example.com:8443');
    expect(getCimdClientHost('registered-client')).toBeUndefined();
  });
});

describe('computeCimdCacheTtlMs', () => {
  const h = (value?: string) => new Headers(value ? { 'cache-control': value } : {});
  it('uses the configured TTL when no directive is present', () => {
    expect(computeCimdCacheTtlMs(h(), 3_600_000)).toBe(3_600_000);
  });
  it('returns 0 for no-store', () => {
    expect(computeCimdCacheTtlMs(h('no-store'), 3_600_000)).toBe(0);
  });
  it('bounds max-age by the configured TTL and a floor', () => {
    expect(computeCimdCacheTtlMs(h('max-age=600'), 3_600_000)).toBe(600_000);
    expect(computeCimdCacheTtlMs(h('max-age=999999'), 3_600_000)).toBe(3_600_000);
    expect(computeCimdCacheTtlMs(h('max-age=1'), 3_600_000)).toBe(30_000);
  });
  it('subtracts Age and caps the configured TTL at 24h', () => {
    const headers = new Headers({ 'cache-control': 'max-age=600', age: '500' });
    expect(computeCimdCacheTtlMs(headers, 3_600_000)).toBe(100_000);
    expect(computeCimdCacheTtlMs(h(), 10 * 24 * 3_600_000)).toBe(24 * 3_600_000);
  });
});
