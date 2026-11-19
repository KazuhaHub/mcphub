import { normalizeReadiness, readinessSlotProblem } from '../../src/utils/readinessConfig.js';
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

describe('server config persistence', () => {
  const base = { type: 'streamable-http' as const, url: 'https://example.com/mcp' };

  it('keeps a normalized readiness', () => {
    const out = normalizeServerConfigForPersistence({
      ...base,
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

  it('accepts a declared slot', () => {
    const out = normalizeServerConfigForPersistence({
      ...base,
      credentialTemplate: [{ target: 'headers', name: 'X-Token' }],
      readiness: { url: 'https://example.com/ready', auth: { credential: 'X-Token' } },
    });
    expect(out.readiness?.auth).toEqual({ credential: 'X-Token' });
  });
});
