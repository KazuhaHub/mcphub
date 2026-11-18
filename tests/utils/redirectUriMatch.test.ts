import {
  allowsLoopbackPortFlexibility,
  redirectUriMatches,
} from '../../src/utils/redirectUriMatch.js';

describe('redirectUriMatches', () => {
  const reg = [
    'http://127.0.0.1/callback',
    'http://[::1]/cb',
    'http://localhost/c?x=1',
    'https://app.example.com:8443/cb',
  ];

  it('always allows exact matches', () => {
    expect(redirectUriMatches(reg, 'https://app.example.com:8443/cb', false)).toBe(true);
    expect(redirectUriMatches(reg, 'http://127.0.0.1/callback', false)).toBe(true);
  });

  it('ignores the port only for loopback hosts when enabled', () => {
    expect(redirectUriMatches(reg, 'http://127.0.0.1:5555/callback', true)).toBe(true);
    expect(redirectUriMatches(reg, 'http://[::1]:5555/cb', true)).toBe(true);
    expect(redirectUriMatches(reg, 'http://localhost:5555/c?x=1', true)).toBe(true);
    expect(redirectUriMatches(reg, 'http://127.0.0.1:5555/callback', false)).toBe(false);
  });

  it.each([
    'http://127.0.0.1:5555/other',
    'http://127.0.0.1:5555/callback/',
    'http://127.0.0.1:5555/callback?a=b',
    'http://localhost:5555/c',
    'http://localhost:5555/c?x=2',
    'https://127.0.0.1:5555/callback',
    'http://127.0.0.2:5555/callback',
    'http://[::1]:0/cb',
    'http://[::1]:70000/cb',
    'http://127.0.0.1:5555/callback#frag',
    'http://u@127.0.0.1:5555/callback',
    'http://127.0.0.1.evil.com:5555/callback',
    'https://app.example.com:9999/cb',
    'https://app.example.com/cb',
  ])('rejects %s', (uri) => {
    expect(redirectUriMatches(reg, uri, true)).toBe(false);
  });

  it('flexibility applies to CIMD and native clients only', () => {
    expect(allowsLoopbackPortFlexibility({ clientId: 'https://a.example.com/c' })).toBe(true);
    expect(
      allowsLoopbackPortFlexibility({ clientId: 'x', metadata: { application_type: 'native' } }),
    ).toBe(true);
    expect(
      allowsLoopbackPortFlexibility({ clientId: 'x', metadata: { application_type: 'web' } }),
    ).toBe(false);
    expect(allowsLoopbackPortFlexibility({ clientId: 'x' })).toBe(false);
  });
});
