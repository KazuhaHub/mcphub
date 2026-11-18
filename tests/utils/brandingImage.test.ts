import {
  BRANDING_MAX_BYTES,
  getBrandingAsset,
  mergeBranding,
  publicBranding,
  validateBrandingImage,
  validateBrandingUpdate,
} from '../../src/utils/brandingImage.js';

const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('rest')]);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>');

const url = (mime: string, bytes: Buffer) => `data:${mime};base64,${bytes.toString('base64')}`;

describe('validateBrandingImage', () => {
  it.each([
    ['image/png', png],
    ['image/jpeg', jpeg],
    ['image/webp', webp],
    ['image/svg+xml', svg],
  ])('accepts %s', (mime, bytes) => {
    expect(validateBrandingImage(url(mime, bytes))).toBeNull();
  });

  it('treats the empty string as a clear request', () => {
    expect(validateBrandingImage('')).toBeNull();
  });

  it.each([
    ['gif', url('image/gif', png)],
    ['text', url('text/html', Buffer.from('<script>1</script>'))],
    ['uppercase mime', url('IMAGE/PNG', png)],
    ['remote URL', 'https://example.com/logo.png'],
    ['javascript URL', 'javascript:alert(1)'],
    ['non-base64 data URL', 'data:image/svg+xml;utf8,<svg></svg>'],
    ['relative path', '/logo.png'],
  ])('rejects %s', (_label, value) => {
    expect(validateBrandingImage(value)).toEqual(expect.any(String));
  });

  it.each([
    ['bad characters', 'data:image/png;base64,@@@@'],
    ['bad padding length', 'data:image/png;base64,iVBORw0KGgo'],
    ['empty payload', 'data:image/png;base64,'],
  ])('rejects invalid base64 (%s)', (_label, value) => {
    expect(validateBrandingImage(value)).toMatch(/base64/);
  });

  it('rejects content that does not match the declared type', () => {
    expect(validateBrandingImage(url('image/png', svg))).toMatch(/does not look like/);
    expect(validateBrandingImage(url('image/svg+xml', png))).toMatch(/does not look like/);
  });

  it('enforces the decoded size limit', () => {
    const atLimit = Buffer.concat([png, Buffer.alloc(BRANDING_MAX_BYTES - png.length)]);
    expect(atLimit.length).toBe(BRANDING_MAX_BYTES);
    expect(validateBrandingImage(url('image/png', atLimit))).toBeNull();
    const over = Buffer.concat([png, Buffer.alloc(BRANDING_MAX_BYTES - png.length + 1)]);
    expect(validateBrandingImage(url('image/png', over))).toMatch(/at most 256 KB/);
  });

  it.each([null, 5, {}, []])('rejects non-strings (%p)', (value) => {
    expect(validateBrandingImage(value)).toBe('must be a string');
  });
});

describe('validateBrandingUpdate', () => {
  it('accepts a partial update and names the failing slot', () => {
    expect(validateBrandingUpdate({ icon: url('image/png', png), logoDark: '' })).toBeNull();
    expect(validateBrandingUpdate({ logoLight: 'https://x.test/a.png' })).toMatch(/^dashboardBranding\.logoLight /);
  });

  it.each([null, 'x', [], { favicon: url('image/png', png) }])('rejects %p', (value) => {
    expect(validateBrandingUpdate(value)).toEqual(expect.any(String));
  });
});

describe('mergeBranding and publicBranding', () => {
  it('sets, keeps and clears slots independently', () => {
    const icon = url('image/png', png);
    const logo = url('image/svg+xml', svg);
    let branding = mergeBranding(undefined, { icon, logoLight: logo });
    expect(branding).toEqual({ icon, logoLight: logo });
    branding = mergeBranding(branding, { logoDark: logo });
    expect(branding).toEqual({ icon, logoLight: logo, logoDark: logo });
    branding = mergeBranding(branding, { icon: '' });
    expect(branding).toEqual({ logoLight: logo, logoDark: logo });
  });

  it('publishes versioned URLs, empty strings for unset or invalid values, and never the bytes', () => {
    const icon = url('image/png', png);
    const out = publicBranding({ icon, logoLight: 'https://x.test/a.png' }, '/hub');
    expect(out.icon).toMatch(/^\/hub\/api\/branding\/icon\?v=[0-9a-f]{12}$/);
    expect(out.logoLight).toBe('');
    expect(out.logoDark).toBe('');
    expect(JSON.stringify(out)).not.toContain('data:');
    expect(publicBranding(undefined, '')).toEqual({ icon: '', logoLight: '', logoDark: '' });
  });

  it('changes the version when the image changes and not otherwise', () => {
    const a = publicBranding({ icon: url('image/png', png) }, '').icon;
    expect(publicBranding({ icon: url('image/png', png) }, '').icon).toBe(a);
    const other = Buffer.concat([png, Buffer.from('more')]);
    expect(publicBranding({ icon: url('image/png', other) }, '').icon).not.toBe(a);
  });

  it('decodes the stored image', () => {
    const asset = getBrandingAsset({ logoDark: url('image/svg+xml', svg) }, 'logoDark');
    expect(asset?.mime).toBe('image/svg+xml');
    expect(asset?.bytes.equals(svg)).toBe(true);
    expect(getBrandingAsset({}, 'icon')).toBeNull();
  });
});
