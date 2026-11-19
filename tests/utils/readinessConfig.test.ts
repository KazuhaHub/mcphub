import {
  normalizeReadiness,
  readinessServerProblem,
  readinessSlotProblem,
} from '../../src/utils/readinessConfig.js';
import { normalizeServerConfigForPersistence } from '../../src/utils/serverConfigPersistence.js';
import { ServerConfigValidationError } from '../../src/utils/serverConfigValidation.js';

describe('normalizeReadiness', () => {
  it('accepts an https url with oauth auth', () => {
    expect(
      normalizeReadiness({ url: ' https://canvas.example.com/readiness ', auth: 'oauth' }),
    ).toEqual({ url: 'https://canvas.example.com/readiness', auth: 'oauth' });
  });

  it('accepts a credential slot auth', () => {
    expect(
      normalizeReadiness({
        url: 'https://ubc.example.com/ready',
        auth: { credential: 'UBC_CONNECTOR_TOKEN' },
      }),
    ).toEqual({
      url: 'https://ubc.example.com/ready',
      auth: { credential: 'UBC_CONNECTOR_TOKEN' },
    });
  });

  it.each([undefined, null, ''])('treats %j as unset', (value) => {
    expect(normalizeReadiness(value)).toBeUndefined();
  });

  it.each([
    [{ url: 'http://example.com/ready', auth: 'oauth' }],
    [{ url: 'http://localhost/ready', auth: 'oauth' }],
    [{ url: 'javascript:alert(1)', auth: 'oauth' }],
    [{ url: '/relative', auth: 'oauth' }],
    [{ url: 'https://user:pw@example.com/ready', auth: 'oauth' }],
    [{ url: 'https://example.com/' + 'a'.repeat(2048), auth: 'oauth' }],
    [{ auth: 'oauth' }],
    [{ url: 'https://example.com/ready' }],
    [{ url: 'https://example.com/ready', auth: 'basic' }],
    [{ url: 'https://example.com/ready', auth: { credential: '' } }],
    [{ url: 'https://example.com/ready', auth: { credential: 42 } }],
    [{ url: 'https://example.com/ready', auth: 'oauth', extra: true }],
    ['https://example.com/ready'],
    [42],
    [[]],
  ])('rejects %j', (value) => {
    expect(() => normalizeReadiness(value)).toThrow(ServerConfigValidationError);
  });
});

describe('readinessSlotProblem', () => {
  const template = [{ target: 'headers' as const, name: 'X-Token' }];

  it('allows oauth and a declared slot', () => {
    expect(readinessSlotProblem({ url: 'https://e.com/r', auth: 'oauth' }, undefined)).toBeNull();
    expect(
      readinessSlotProblem({ url: 'https://e.com/r', auth: { credential: 'X-Token' } }, template),
    ).toBeNull();
  });

  it('refuses a slot the server does not declare', () => {
    expect(
      readinessSlotProblem({ url: 'https://e.com/r', auth: { credential: 'OTHER' } }, template),
    ).toMatch(/credential slot/);
    expect(
      readinessSlotProblem({ url: 'https://e.com/r', auth: { credential: 'X-Token' } }, undefined),
    ).toMatch(/credential slot/);
  });
});

describe('readinessServerProblem: the bearer only goes where the user already trusts', () => {
  const server = {
    url: 'https://canvas.example.com/mcp',
    oauth: { identityMode: 'personal' },
  } as never;
  const at = (url: string) => readinessServerProblem({ url, auth: 'oauth' }, server);

  it('accepts the same origin, whatever the path or query', () => {
    expect(at('https://canvas.example.com/readiness')).toBeNull();
    expect(at('https://canvas.example.com/other/path?x=1')).toBeNull();
    expect(at('https://canvas.example.com:443/readiness')).toBeNull();
  });

  it.each([
    ['a different host', 'https://evil.example.org/readiness'],
    ['a different port', 'https://canvas.example.com:8443/readiness'],
    ['http', 'http://canvas.example.com/readiness'],
    ['a subdomain', 'https://api.canvas.example.com/readiness'],
    ['a parent domain', 'https://example.com/readiness'],
    ['a lookalike suffix', 'https://canvas.example.com.evil.net/readiness'],
  ])('rejects %s', (_label, url) => {
    expect(at(url)).toMatch(/same origin/);
  });

  it('fails closed when the server url cannot be read as a URL', () => {
    expect(
      readinessServerProblem({ url: 'https://canvas.example.com/r', auth: 'oauth' }, {
        url: '{{url.HOST}}/mcp',
        oauth: { identityMode: 'personal' },
      } as never),
    ).toMatch(/same origin/);
  });

  it('does not constrain a server without a url, but oauth needs personal OAuth', () => {
    const stdio = {
      command: 'node',
      credentialTemplate: [{ target: 'env', name: 'TOKEN' }],
    } as never;
    expect(
      readinessServerProblem(
        { url: 'https://any.example.com/r', auth: { credential: 'TOKEN' } },
        stdio,
      ),
    ).toBeNull();
    expect(
      readinessServerProblem({ url: 'https://any.example.com/r', auth: 'oauth' }, stdio),
    ).toMatch(/personal OAuth/);
  });

  it('rejects oauth auth on a remote server without personal OAuth', () => {
    expect(
      readinessServerProblem({ url: 'https://canvas.example.com/r', auth: 'oauth' }, {
        url: 'https://canvas.example.com/mcp',
      } as never),
    ).toMatch(/personal OAuth/);
  });
});

describe('server config persistence', () => {
  const base = { type: 'streamable-http' as const, url: 'https://example.com/mcp' };

  it('keeps a normalized readiness', () => {
    const out = normalizeServerConfigForPersistence({
      ...base,
      oauth: { identityMode: 'personal' },
      readiness: { url: ' https://example.com/ready ', auth: 'oauth' },
    });
    expect(out.readiness).toEqual({ url: 'https://example.com/ready', auth: 'oauth' });
  });

  it('clears it with null and leaves it absent when the key is absent', () => {
    expect(
      normalizeServerConfigForPersistence({ ...base, readiness: null as never }),
    ).toHaveProperty('readiness', undefined);
    expect(normalizeServerConfigForPersistence(base)).not.toHaveProperty('readiness');
  });

  it('rejects http and a slot missing from the template', () => {
    expect(() =>
      normalizeServerConfigForPersistence({
        ...base,
        readiness: { url: 'http://example.com/ready', auth: 'oauth' },
      }),
    ).toThrow(ServerConfigValidationError);
    expect(() =>
      normalizeServerConfigForPersistence({
        ...base,
        credentialTemplate: [{ target: 'headers', name: 'X-Token' }],
        readiness: { url: 'https://example.com/ready', auth: { credential: 'NOPE' } },
      }),
    ).toThrow(ServerConfigValidationError);
  });

  it('rejects a cross-origin url, and oauth without personal OAuth, on save', () => {
    expect(() =>
      normalizeServerConfigForPersistence({
        ...base,
        oauth: { identityMode: 'personal' },
        readiness: { url: 'https://other.example.org/ready', auth: 'oauth' },
      }),
    ).toThrow(/same origin/);
    expect(() =>
      normalizeServerConfigForPersistence({
        ...base,
        readiness: { url: 'https://example.com/ready', auth: 'oauth' },
      }),
    ).toThrow(/personal OAuth/);
  });

  it('accepts a declared slot', () => {
    const out = normalizeServerConfigForPersistence({
      ...base,
      credentialTemplate: [{ target: 'headers', name: 'X-Token' }],
      readiness: { url: 'https://example.com/ready', auth: { credential: 'X-Token' } },
    });
    expect(out.readiness?.auth).toEqual({ credential: 'X-Token' });
  });
});
