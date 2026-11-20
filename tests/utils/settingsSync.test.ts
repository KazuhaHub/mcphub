import {
  normalizeDeclaredServer,
  normalizeStoredServer,
  resolveSyncedServerId,
} from '../../src/utils/settingsSync.js';
import { isLegacyServerId, legacyServerId } from '../../src/utils/serverIdentity.js';

/**
 * Settings sync writes the DB row directly, so it never goes through the DAO's
 * "materialize a UUID on first write" rule. A name-derived placeholder must not
 * be persisted or staging would refuse the server forever (#1056, R14).
 */
describe('resolveSyncedServerId', () => {
  it('gives a server that exists only in the declaration a random UUID', () => {
    const id = resolveSyncedServerId(undefined, undefined, 'remote');

    expect(id).toBeValidUUID();
    expect(isLegacyServerId(id, 'remote')).toBe(false);
  });

  it('ignores a legacy placeholder declared in the synced file', () => {
    const id = resolveSyncedServerId(undefined, legacyServerId('remote'), 'remote');

    expect(id).toBeValidUUID();
    expect(isLegacyServerId(id, 'remote')).toBe(false);
  });

  it('preserves the existing row id', () => {
    expect(resolveSyncedServerId('11111111-1111-4111-8111-111111111111', undefined, 'remote')).toBe(
      '11111111-1111-4111-8111-111111111111',
    );
  });

  it('preserves a declared UUID when the server is new', () => {
    expect(resolveSyncedServerId(undefined, '22222222-2222-4222-8222-222222222222', 'remote')).toBe(
      '22222222-2222-4222-8222-222222222222',
    );
  });
});

describe('normalizeDeclaredServer', () => {
  const remote = { type: 'streamable-http' as const, url: 'https://svc.example.com/mcp' };

  it('keeps a valid readiness declaration', () => {
    const config = normalizeDeclaredServer('svc', {
      ...remote,
      oauth: { identityMode: 'personal' },
      readiness: { url: 'https://svc.example.com/ready', auth: 'oauth' },
    });
    expect(config.readiness).toEqual({ url: 'https://svc.example.com/ready', auth: 'oauth' });
  });

  it.each([
    { url: 'http://svc.example.com/ready', auth: 'oauth' },
    { url: 'https://evil.example.org/ready', auth: 'oauth' },
    'not an object',
    { url: 5 },
  ])('drops an invalid readiness %j instead of failing the whole sync', (readiness) => {
    const config = normalizeDeclaredServer('svc', {
      ...remote,
      oauth: { identityMode: 'personal' },
      readiness: readiness as never,
    });
    expect(config.readiness).toBeUndefined();
    expect(config.url).toBe(remote.url);
  });

  it('still fails for an error that is not about readiness', () => {
    expect(() =>
      normalizeDeclaredServer('svc', {
        ...remote,
        tags: 'nope' as never,
        readiness: { url: 'http://x', auth: 'oauth' },
      }),
    ).toThrow();
  });
});

describe('normalizeStoredServer', () => {
  const stored = {
    type: 'streamable-http' as const,
    url: 'https://svc.example.com/mcp',
    pausedUsers: ['bob'],
    maintenance: { message: 'x' },
  };

  it('ignores runtime admin state', () => {
    const config = normalizeStoredServer('svc', stored as never);
    expect(config.pausedUsers).toBeUndefined();
    expect(config.maintenance).toBeUndefined();
    expect(config.type).toBe('streamable-http');
  });

  it('does not throw for a stored readiness that is no longer valid', () => {
    // The server url moved to another origin after the row was saved.
    const config = normalizeStoredServer('svc', {
      ...stored,
      url: 'https://moved.example.net/mcp',
      oauth: { identityMode: 'personal' },
      readiness: { url: 'https://svc.example.com/ready', auth: 'oauth' },
    } as never);
    expect(config.readiness).toBeUndefined();
    expect(config.url).toBe('https://moved.example.net/mcp');
  });
});
