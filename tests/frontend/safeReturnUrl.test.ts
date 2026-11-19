import { isSafeRelativeUrl, sanitizeReturnUrl } from '../../frontend/src/utils/safeReturnUrl';

const ORIGIN = 'https://hub.example.com';

describe('sanitizeReturnUrl', () => {
  it.each([
    ['/', '/'],
    ['/servers', '/servers'],
    ['/servers?tab=tools&q=a%2Fb#top', '/servers?tab=tools&q=a%2Fb#top'],
    [
      '/oauth/authorize?client_id=c&redirect_uri=https%3A%2F%2Fclaude.ai%2Fcb&state=s',
      '/oauth/authorize?client_id=c&redirect_uri=https%3A%2F%2Fclaude.ai%2Fcb&state=s',
    ],
    ['/hub/services/demo?x=1', '/hub/services/demo?x=1'],
    ['/a/./b/../c', '/a/c'],
    [`${ORIGIN}/settings#keys`, '/settings#keys'],
    ['settings', '/settings'],
  ])('keeps %s as %s', (value, expected) => {
    expect(sanitizeReturnUrl(value, ORIGIN)).toBe(expected);
  });

  it.each([
    // Dot segments and own-origin absolute URLs that normalise to a protocol-relative path
    '/.//evil.com',
    '/..//evil.com',
    '/./..//evil.com/path',
    `${ORIGIN}//evil.com`,
    `${ORIGIN}/.//evil.com`,
    // Protocol-relative and backslash forms
    '//evil.com',
    '///evil.com',
    '/\\evil.com',
    '\\\\evil.com',
    '/foo\\bar',
    // Encoded separators in the path
    '%2F%2Fevil.com',
    '/%2F%2Fevil.com',
    '/%2f/evil.com',
    '/%5Cevil',
    '/%5cevil.com',
    // Other origins and schemes
    'https://evil.com/oauth/authorize',
    'http://hub.example.com/settings',
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    // Control characters, which URL parsers strip
    '/\t/evil.com',
    '/\n/evil.com',
    '/\r\n/evil.com',
    '\t//evil.com',
    '/servers\u0000',
    '/servers\u0085',
    '',
    null,
  ])('rejects %p', (value) => {
    expect(sanitizeReturnUrl(value as string | null, ORIGIN)).toBeNull();
  });
});

describe('isSafeRelativeUrl', () => {
  it.each(['/', '/servers?x=%2F#a%5C', '/oauth/authorize?redirect_uri=https%3A%2F%2Fx'])(
    'accepts %s',
    (value) => expect(isSafeRelativeUrl(value)).toBe(true),
  );

  it.each(['//evil.com', '/\\evil.com', '/%2Fevil.com', 'servers', 'https://evil.com', '/a\tb'])(
    'rejects %p',
    (value) => expect(isSafeRelativeUrl(value)).toBe(false),
  );
});
