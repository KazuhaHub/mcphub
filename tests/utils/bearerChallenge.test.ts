import {
  buildBearerChallenge,
  escapeHeaderValue,
  getResourceScopes,
} from '../../src/utils/bearerChallenge.js';

describe('buildBearerChallenge', () => {
  it('carries no error code when the request had no credentials', () => {
    expect(
      buildBearerChallenge({
        errorDescription: 'ignored without an error code',
        resourceMetadata: 'https://hub.example/.well-known/oauth-protected-resource/mcp',
        scopes: ['read', 'write'],
      }),
    ).toBe(
      'Bearer resource_metadata="https://hub.example/.well-known/oauth-protected-resource/mcp", scope="read write"',
    );
  });

  it('keeps the error code and description for an invalid token', () => {
    expect(
      buildBearerChallenge({
        error: 'invalid_token',
        errorDescription: 'Invalid bearer token',
        resourceMetadata: 'https://hub.example/meta',
        scopes: ['read'],
      }),
    ).toBe(
      'Bearer error="invalid_token", error_description="Invalid bearer token", resource_metadata="https://hub.example/meta", scope="read"',
    );
  });

  it('formats an insufficient_scope challenge', () => {
    expect(
      buildBearerChallenge({
        error: 'insufficient_scope',
        resourceMetadata: 'https://hub.example/meta',
        scopes: ['write'],
      }),
    ).toBe(
      'Bearer error="insufficient_scope", resource_metadata="https://hub.example/meta", scope="write"',
    );
  });

  it('omits scope when there are none and falls back to a bare scheme', () => {
    expect(buildBearerChallenge({ scopes: [] })).toBe('Bearer');
  });

  it('escapes quotes and backslashes and drops control characters', () => {
    expect(escapeHeaderValue('a"b\\c\r\nd')).toBe('a\\"b\\\\cd');
    const header = buildBearerChallenge({
      error: 'invalid_token',
      errorDescription: 'bad "x"\r\nSet-Cookie: a=b',
      resourceMetadata: 'https://hub.example/a"b',
    });
    expect(header).not.toMatch(/[\r\n]/);
    expect(header).toContain('error_description="bad \\"x\\"Set-Cookie: a=b"');
    expect(header).toContain('resource_metadata="https://hub.example/a\\"b"');
  });
});

describe('getResourceScopes', () => {
  it('defaults to the default allowed scopes', () => {
    expect(getResourceScopes(null)).toEqual(['read', 'write']);
    expect(getResourceScopes({ oauthServer: { enabled: true } })).toEqual(['read', 'write']);
  });

  it('never includes offline_access or credential-write scopes, and dedupes', () => {
    expect(
      getResourceScopes({
        oauthServer: {
          enabled: true,
          allowedScopes: ['read', 'offline_access', 'credentials:write:foo', 'read', ' write ', ''],
        },
      }),
    ).toEqual(['read', 'write']);
  });

  it('is empty when the OAuth server is disabled', () => {
    expect(getResourceScopes({ oauthServer: { enabled: false } })).toEqual([]);
  });
});
