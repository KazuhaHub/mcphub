import type { ServerConfig } from '../../src/types/index.js';

const mockResolveCredentialBinding = jest.fn();
const mockPersonalLoad = jest.fn();
const mockProviderCreate = jest.fn();
const mockResolveSelf = jest.fn();

jest.mock('../../src/services/credentialBindingService.js', () => {
  const { EventEmitter } = jest.requireActual('node:events');
  return {
    credentialBindingEvents: new EventEmitter(),
    resolveCredentialBinding: (...args: unknown[]) => mockResolveCredentialBinding(...args),
  };
});
jest.mock('../../src/services/personalOAuthService.js', () => ({
  hasPersonalOAuth: (config?: { oauth?: { identityMode?: string } }) =>
    config?.oauth?.identityMode === 'personal',
  PersonalOAuthContext: { load: (...args: unknown[]) => mockPersonalLoad(...args) },
}));
jest.mock('../../src/services/mcpOAuthProvider.js', () => ({
  MCPHubOAuthProvider: { create: (...args: unknown[]) => mockProviderCreate(...args) },
}));
jest.mock('../../src/services/selfOAuthResource.js', () => ({
  resolveSelfResourceForConnection: (...args: unknown[]) => mockResolveSelf(...args),
}));

import { logger } from '../../src/utils/logger.js';
import { resolvedCredentialValues } from '../../src/utils/credentialTemplate.js';
import { MissingCredentialError } from '../../src/utils/credentialTemplate.js';
import { credentialBindingEvents } from '../../src/services/credentialBindingService.js';
import {
  READINESS_CACHE_TTL_MS,
  READINESS_MAX_BODY_BYTES,
  clearReadinessCache,
  getServiceReadiness,
  getServiceReadinessBounded,
  resolveReadinessBearer,
  type ReadinessDeps,
} from '../../src/services/serviceReadinessService.js';

const BEARER = 'secret-bearer-value-123';
const user = { username: 'alice' };
const definition = (extra: Partial<ServerConfig> = {}): ServerConfig => ({
  type: 'streamable-http',
  url: 'https://svc.example.com/mcp',
  readiness: { url: 'https://svc.example.com/readiness', auth: 'oauth' },
  ...extra,
});

const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });

let fetchMock: jest.Mock;
let now: number;
const deps = (extra: Partial<ReadinessDeps> = {}): ReadinessDeps => ({
  resolveBearer: async () => BEARER,
  fetch: fetchMock as unknown as ReadinessDeps['fetch'],
  now: () => now,
  timeoutMs: 200,
  // A public address, so the SSRF guard never needs real DNS.
  lookup: async () => ['93.184.216.34'],
  ...extra,
});
const check = (
  def: ServerConfig = definition(),
  options: { refresh?: boolean } = {},
  extra: Partial<ReadinessDeps> = {},
) => getServiceReadiness(user, 'canvas', def, { ...options, deps: deps(extra) });

beforeEach(() => {
  clearReadinessCache();
  now = Date.parse('2026-11-19T10:00:00Z');
  fetchMock = jest.fn(async () => jsonResponse({ version: 1, state: 'ready' }));
  jest.clearAllMocks();
});

describe('getServiceReadiness', () => {
  it('returns null when the server has no readiness config', async () => {
    expect(await check({ type: 'sse', url: 'https://x.example.com' })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends a bearer GET without redirects or cookies', async () => {
    await check();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://svc.example.com/readiness');
    expect(init.method ?? 'GET').toBe('GET');
    expect(init.headers).toMatchObject({
      Accept: 'application/json',
      Authorization: `Bearer ${BEARER}`,
    });
    expect(init.redirect).toBe('manual');
    expect(init.credentials).toBe('omit');
    expect(init.signal).toBeDefined();
  });

  it.each(['ready', 'needs_setup', 'degraded', 'expired', 'revoked'] as const)(
    'maps the %s state with its fields',
    async (state) => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          version: 1,
          state,
          summary: 'Canvas token missing',
          action: { label: 'Set up Canvas token', url: 'https://canvas.example.com/setup' },
          checked_at: '2026-11-19T09:59:00Z',
          extra: 'ignored',
        }),
      );
      expect(await check()).toEqual({
        state,
        summary: 'Canvas token missing',
        action: { label: 'Set up Canvas token', url: 'https://canvas.example.com/setup' },
        expiresAt: null,
        checkedAt: '2026-11-19T09:59:00.000Z',
      });
    },
  );

  it('maps expiring with expires_at', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ version: 1, state: 'expiring', expires_at: '2026-12-01T00:00:00Z' }),
    );
    expect(await check()).toMatchObject({
      state: 'expiring',
      expiresAt: '2026-12-01T00:00:00.000Z',
      summary: null,
      action: null,
      checkedAt: '2026-11-19T10:00:00.000Z',
    });
  });

  it('treats expiring without expires_at as unknown', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ version: 1, state: 'expiring' }));
    expect((await check())?.state).toBe('unknown');
  });

  it('caps the summary at 200 characters and drops an unsafe action', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        version: 1,
        state: 'needs_setup',
        summary: 'x'.repeat(500),
        action: { label: 'Go', url: 'http://insecure.example.com' },
      }),
    );
    const result = await check();
    expect(result?.summary).toHaveLength(200);
    expect(result?.action).toBeNull();
  });

  it.each([401, 403])('maps HTTP %i to revoked with hub-owned wording', async (status) => {
    fetchMock.mockResolvedValue(jsonResponse({ state: 'ready', version: 1 }, { status }));
    expect(await check()).toMatchObject({ state: 'revoked', summary: null, action: null });
  });

  it.each([
    ['5xx', () => jsonResponse({ version: 1, state: 'ready' }, { status: 503 })],
    ['404', () => jsonResponse({ version: 1, state: 'ready' }, { status: 404 })],
    ['bad json', () => jsonResponse('{not json')],
    [
      'non-json content type',
      () =>
        new Response('{"version":1,"state":"ready"}', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
    ],
    ['unknown state', () => jsonResponse({ version: 1, state: 'on_fire' })],
    ['unknown version', () => jsonResponse({ version: 2, state: 'ready' })],
    ['missing version', () => jsonResponse({ state: 'ready' })],
    ['array body', () => jsonResponse([])],
    [
      'oversized',
      () =>
        jsonResponse(
          JSON.stringify({
            version: 1,
            state: 'ready',
            summary: 'a'.repeat(READINESS_MAX_BODY_BYTES),
          }),
        ),
    ],
  ])('maps %s to unknown', async (_name, make) => {
    fetchMock.mockImplementation(async () => make());
    expect(await check()).toMatchObject({ state: 'unknown', summary: null, action: null });
  });

  it('maps a network error to unknown', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    expect((await check())?.state).toBe('unknown');
  });

  it('times out to unknown', async () => {
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const started = Date.now();
    expect((await check(definition(), {}, { timeoutMs: 30 }))?.state).toBe('unknown');
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('does not follow redirects', async () => {
    fetchMock.mockResolvedValue(
      new Response(null, { status: 302, headers: { location: 'https://evil.example.com/ready' } }),
    );
    expect((await check())?.state).toBe('unknown');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(['https://127.0.0.1/readiness', 'https://[::1]/readiness', 'https://10.0.0.5/r'])(
    'never contacts the blocked address %s',
    async (url) => {
      const result = await check(definition({ readiness: { url, auth: 'oauth' } }));
      expect(result?.state).toBe('unknown');
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('blocks a host that resolves to a private address', async () => {
    const result = await check(definition(), {}, { lookup: async () => ['192.168.1.20'] });
    expect(result?.state).toBe('unknown');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a stored non-https url', async () => {
    const result = await check(
      definition({ readiness: { url: 'http://svc.example.com/r', auth: 'oauth' } }),
    );
    expect(result?.state).toBe('unknown');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never logs the bearer, even when an error carries it', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) =>
      jest.spyOn(logger, level).mockImplementation(() => undefined),
    );
    fetchMock.mockRejectedValue(new Error(`connect failed with Bearer ${BEARER}`));
    await check();
    fetchMock.mockResolvedValue(jsonResponse({ version: 1, state: 'ready' }, { status: 401 }));
    await check(definition(), { refresh: true });
    const logged = JSON.stringify(spies.flatMap((spy) => spy.mock.calls));
    expect(logged).not.toContain(BEARER);
    spies.forEach((spy) => spy.mockRestore());
  });

  it('maps a rejected or unrefreshable credential to revoked, other failures to unknown', async () => {
    const missing = await check(
      definition(),
      {},
      {
        resolveBearer: async () => {
          throw new MissingCredentialError('Personal authorization required');
        },
      },
    );
    expect(missing?.state).toBe('revoked');
    clearReadinessCache();
    const broken = await check(
      definition(),
      {},
      {
        resolveBearer: async () => {
          throw new Error('disk on fire');
        },
      },
    );
    expect(broken?.state).toBe('unknown');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('same-origin rule at probe time', () => {
  it('fails closed when the server url no longer shares the readiness origin', async () => {
    const moved = definition({ url: 'https://moved.example.net/mcp' });
    expect((await check(moved))?.state).toBe('unknown');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('probes when the origin matches and when the server has no url', async () => {
    await check(definition({ url: 'https://svc.example.com/mcp' }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    clearReadinessCache();
    await check(definition({ url: undefined, command: 'node' }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('credential failures', () => {
  it('maps "OAuth access token expired; reconnect" to revoked', async () => {
    const result = await check(
      definition(),
      {},
      {
        resolveBearer: async () => {
          throw new Error('OAuth access token expired; reconnect');
        },
      },
    );
    expect(result?.state).toBe('revoked');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('caching races', () => {
  it('does not share an in-flight probe between two declarations', async () => {
    const urls: string[] = [];
    fetchMock.mockImplementation(async (url: string) => {
      urls.push(String(url));
      await new Promise((resolve) => setTimeout(resolve, 20));
      return jsonResponse({ version: 1, state: 'ready' });
    });
    await Promise.all([
      check(definition({ readiness: { url: 'https://svc.example.com/old', auth: 'oauth' } })),
      check(definition({ readiness: { url: 'https://svc.example.com/new', auth: 'oauth' } })),
    ]);
    expect(urls.sort()).toEqual(['https://svc.example.com/new', 'https://svc.example.com/old']);
  });

  it('does not cache an answer whose credential changed while it was being fetched', async () => {
    fetchMock.mockImplementation(async () => {
      credentialBindingEvents.emit('invalidate', { serverName: 'canvas', username: 'alice' });
      return jsonResponse({ version: 1, state: 'ready' });
    });
    await check();
    fetchMock.mockClear();
    fetchMock.mockImplementation(async () => jsonResponse({ version: 1, state: 'needs_setup' }));
    expect((await check())?.state).toBe('needs_setup');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('the SSRF policy', () => {
  it('ignores the system allowlist of internal ranges: a user credential never goes to one', async () => {
    const seen: unknown[] = [];
    jest.isolateModules(() => undefined);
    const ssrf = jest.requireActual(
      '../../src/utils/ssrf.js',
    ) as typeof import('../../src/utils/ssrf.js');
    const spy = jest.spyOn(ssrf, 'createRedirectValidatingFetch');
    await check();
    seen.push(...spy.mock.calls[0]);
    spy.mockRestore();
    // (fetch, allowInternal, lookup, allowedCidrs, serverId, maxHops)
    expect(seen[1]).toBe(false);
    expect(seen[3]).toEqual([]);
    expect(seen[5]).toBe(0);
  });
});

describe('caching', () => {
  it('serves a repeat call from the cache for five minutes', async () => {
    await check();
    await check();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    now += READINESS_CACHE_TTL_MS - 1;
    await check();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    now += 2;
    await check();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('bypasses the cache on an explicit re-check', async () => {
    await check();
    fetchMock.mockResolvedValue(jsonResponse({ version: 1, state: 'needs_setup' }));
    now += 10_000;
    expect((await check(definition(), { refresh: true }))?.state).toBe('needs_setup');
    expect((await check())?.state).toBe('needs_setup');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throttles repeated re-checks within a few seconds', async () => {
    await check(definition(), { refresh: true });
    await check(definition(), { refresh: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps users and servers apart', async () => {
    await getServiceReadiness({ username: 'alice' }, 'canvas', definition(), { deps: deps() });
    await getServiceReadiness({ username: 'bob' }, 'canvas', definition(), { deps: deps() });
    await getServiceReadiness({ username: 'alice' }, 'ubc', definition(), { deps: deps() });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('misses when the readiness declaration changes', async () => {
    await check();
    await check(definition({ readiness: { url: 'https://svc.example.com/v2', auth: 'oauth' } }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('remembers a failure only briefly', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    expect((await check())?.state).toBe('unknown');
    now += 31_000;
    expect((await check())?.state).toBe('ready');
  });

  it('drops cached entries when the user changes their credential', async () => {
    await check();
    credentialBindingEvents.emit('invalidate', { serverName: 'canvas', username: 'alice' });
    await check();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('shares one request between concurrent checks', async () => {
    await Promise.all([check(), check(), check()]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('getServiceReadinessBounded', () => {
  it('answers unknown when the probe is slow, and the probe still fills the cache', async () => {
    let release!: () => void;
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve(jsonResponse({ version: 1, state: 'ready' }));
        }),
    );
    const result = await getServiceReadinessBounded(user, 'canvas', definition(), {
      waitMs: 10,
      deps: deps({ timeoutMs: 5000 }),
    });
    expect(result).toMatchObject({ state: 'unknown' });
    release();
    await new Promise((resolve) => setTimeout(resolve, 20));
    fetchMock.mockClear();
    expect((await check())?.state).toBe('ready');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never rejects', async () => {
    const result = await getServiceReadinessBounded(user, 'canvas', definition(), {
      waitMs: 50,
      deps: deps({
        resolveBearer: async () => {
          throw new Error('x');
        },
      }),
    });
    expect(result?.state).toBe('unknown');
  });
});

describe('resolveReadinessBearer', () => {
  const slotDefinition = definition({
    credentialTemplate: [
      { target: 'headers', name: 'X-Other' },
      { target: 'headers', name: 'UBC_CONNECTOR_TOKEN' },
    ],
    readiness: { url: 'https://svc.example.com/r', auth: { credential: 'UBC_CONNECTOR_TOKEN' } },
  });

  it('reads the named credential slot through the binding resolver', async () => {
    mockResolveCredentialBinding.mockImplementation(async () => {
      const config = { ...slotDefinition };
      resolvedCredentialValues.set(config, ['other-value', 'slot-token-value']);
      return { config, revision: 'r1' };
    });
    expect(await resolveReadinessBearer(user, 'ubc', slotDefinition)).toBe('slot-token-value');
    expect(mockResolveCredentialBinding).toHaveBeenCalledWith('ubc', 'alice', slotDefinition);
  });

  it('uses the personal OAuth access token, refreshed by the provider', async () => {
    const oauthDefinition = definition({ oauth: { identityMode: 'personal' } as never });
    const context = { config: { ...oauthDefinition } };
    mockPersonalLoad.mockResolvedValue(context);
    mockResolveSelf.mockResolvedValue(undefined);
    const openApiAccessToken = jest.fn(async () => 'oauth-access-token');
    mockProviderCreate.mockResolvedValue({ openApiAccessToken });
    expect(await resolveReadinessBearer(user, 'canvas', oauthDefinition)).toBe(
      'oauth-access-token',
    );
    expect(mockPersonalLoad).toHaveBeenCalledWith('canvas', 'alice', oauthDefinition);
    expect(mockProviderCreate).toHaveBeenCalledWith('canvas', context.config, undefined);
  });

  it('treats oauth auth on a server without personal OAuth as a configuration problem, not a rejected credential', async () => {
    const rejected = resolveReadinessBearer(user, 'canvas', definition());
    await expect(rejected).rejects.toThrow(/personal OAuth/);
    await expect(rejected).rejects.not.toBeInstanceOf(MissingCredentialError);
  });

  it('works on a server that also has a URL credential slot', async () => {
    const withUrlSlot = definition({
      url: 'https://mcp.example.com/{{url.TENANT}}/mcp',
      credentialTemplate: [
        { target: 'url', name: 'TENANT', allowed: ['acme'] },
        { target: 'headers', name: 'X-Token' },
      ],
      readiness: { url: 'https://svc.example.com/r', auth: { credential: 'X-Token' } },
    });
    mockResolveCredentialBinding.mockImplementation(async () => {
      // The resolver substitutes the URL slot, so the resolved url has no placeholder left.
      const config = { ...withUrlSlot, url: 'https://mcp.example.com/acme/mcp' };
      resolvedCredentialValues.set(config, ['acme', 'header-token']);
      return { config, revision: 'r1' };
    });
    expect(await resolveReadinessBearer(user, 'ubc', withUrlSlot)).toBe('header-token');
  });

  it('sends a slot holding a full "Bearer ..." header value as the bare token', async () => {
    const withHeader = definition({
      credentialTemplate: [{ target: 'headers', name: 'Authorization' }],
      readiness: { url: 'https://svc.example.com/r', auth: { credential: 'Authorization' } },
    });
    mockResolveCredentialBinding.mockImplementation(async () => {
      const config = { ...withHeader };
      resolvedCredentialValues.set(config, ['Bearer abc123']);
      return { config, revision: 'r1' };
    });
    expect(await resolveReadinessBearer(user, 'ubc', withHeader)).toBe('abc123');
  });
});
