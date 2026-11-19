import {
  getServerIconAsset,
  normalizeServerIcon,
  readStoredServerIcon,
  serverIconUrl,
  withServerIconUrl,
} from '../../src/utils/serverIcon.js';
import { ServerConfigValidationError } from '../../src/utils/serverConfigValidation.js';

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('pixels'),
]);
const url = (mime: string, bytes: Buffer) => `data:${mime};base64,${bytes.toString('base64')}`;
const pngUrl = url('image/png', png);

describe('normalizeServerIcon', () => {
  it('accepts PNG, JPEG, WebP and SVG data URLs', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
    for (const value of [
      pngUrl,
      url('image/jpeg', jpeg),
      url('image/webp', webp),
      url('image/svg+xml', svg),
    ]) {
      expect(normalizeServerIcon(value)).toBe(value);
    }
  });

  it('treats unset, null and empty as "no icon"', () => {
    expect(normalizeServerIcon(undefined)).toBeUndefined();
    expect(normalizeServerIcon(null)).toBeUndefined();
    expect(normalizeServerIcon('')).toBeUndefined();
  });

  it.each([
    ['a remote URL', 'https://example.com/icon.png'],
    ['a protocol-relative URL', '//example.com/icon.png'],
    ['a type that is not allowed', url('image/gif', Buffer.from('GIF89a'))],
    ['an HTML data URL', url('text/html', Buffer.from('<script>1</script>'))],
    ['bytes that are not the declared type', url('image/png', Buffer.from('not a png'))],
    ['more than 256 KB decoded', url('image/png', Buffer.concat([png, Buffer.alloc(257 * 1024)]))],
    ['text that is not base64', 'data:image/png;base64,@@@@'],
    ['a non-string', 42],
  ])('rejects %s', (_label, value) => {
    expect(() => normalizeServerIcon(value)).toThrow(ServerConfigValidationError);
    expect(() => normalizeServerIcon(value)).toThrow(/^icon /);
  });

  it('accepts an image of exactly 256 KB', () => {
    const exact = Buffer.concat([png, Buffer.alloc(256 * 1024 - png.length)]);
    expect(normalizeServerIcon(url('image/png', exact))).toBeDefined();
  });
});

describe('readStoredServerIcon', () => {
  it('keeps a valid stored icon and drops an invalid one instead of failing', () => {
    expect(readStoredServerIcon(pngUrl)).toBe(pngUrl);
    expect(readStoredServerIcon('https://example.com/x.png')).toBeUndefined();
    expect(readStoredServerIcon(null)).toBeUndefined();
  });
});

describe('server icon URLs', () => {
  it('derives a same-origin versioned URL from the image bytes', () => {
    const first = serverIconUrl('notes', pngUrl, '/hub');
    expect(first).toMatch(/^\/hub\/api\/servers\/notes\/icon\?v=[0-9a-f]{12}$/);
    const other = url('image/png', Buffer.concat([png, Buffer.from('x')]));
    expect(serverIconUrl('notes', other, '/hub')).not.toBe(first);
  });

  it('encodes names with slashes, spaces and Chinese', () => {
    expect(serverIconUrl('a/b c 笔记', pngUrl, '')).toContain(
      `/api/servers/${encodeURIComponent('a/b c 笔记')}/icon?v=`,
    );
  });

  it('has no URL without a valid icon', () => {
    expect(serverIconUrl('notes', undefined, '')).toBeUndefined();
    expect(serverIconUrl('notes', '', '')).toBeUndefined();
    expect(serverIconUrl('notes', 'https://example.com/x.png', '')).toBeUndefined();
  });

  it('replaces the stored data by its URL, or drops an invalid value, without mutating', () => {
    const config = { description: 'd', icon: pngUrl };
    const shown = withServerIconUrl('notes', config, '');
    expect(shown.icon).toMatch(/^\/api\/servers\/notes\/icon\?v=/);
    expect(config.icon).toBe(pngUrl);
    expect(withServerIconUrl('notes', { icon: 'bogus' }, '')).toEqual({});
    const none = { description: 'd' };
    expect(withServerIconUrl('notes', none, '')).toBe(none);
  });

  it('decodes once per stored value and refreshes when it changes', () => {
    const a = getServerIconAsset('cached', pngUrl);
    expect(getServerIconAsset('cached', pngUrl)).toBe(a);
    const next = url('image/png', Buffer.concat([png, Buffer.from('2')]));
    expect(getServerIconAsset('cached', next)?.sha256).not.toBe(a?.sha256);
  });
});
