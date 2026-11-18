import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BrandMark, useBrandLogo } from '../../frontend/src/components/BrandMark';
import { dataUrlBytes } from '../../frontend/src/utils/brandingImage';

let mockBranding = { icon: '', logoLight: '', logoDark: '' };
let mockTheme: 'light' | 'dark' = 'light';

jest.mock('@/contexts/BrandingContext', () => ({
  useBranding: () => ({ branding: mockBranding }),
}));
jest.mock('@/contexts/ThemeContext', () => ({ useTheme: () => ({ resolvedTheme: mockTheme }) }));

const ICON = 'data:image/png;base64,iVBORw0KGgo=';
const LIGHT = 'data:image/svg+xml;base64,PHN2Zy8+';
const DARK = 'data:image/webp;base64,UklGRg==';

const LogoProbe = () => createElement('span', { 'data-logo': useBrandLogo() });
const logo = () => /data-logo="([^"]*)"/.exec(renderToStaticMarkup(createElement(LogoProbe)))![1];
const mark = (props: Parameters<typeof BrandMark>[0] = { variant: 'gradient' }) =>
  renderToStaticMarkup(createElement(BrandMark, props));

beforeEach(() => {
  mockBranding = { icon: '', logoLight: '', logoDark: '' };
  mockTheme = 'light';
});

describe('BrandMark', () => {
  it.each(['gradient', 'ink'] as const)('renders the M tile when no icon is set (%s)', (variant) => {
    const html = mark({ variant });
    expect(html).toContain('data-brand-mark="tile"');
    expect(html).toContain('>M<');
    expect(html).not.toContain('<img');
  });

  it('renders the uploaded icon as an image, without the tile, and keeps the status dot', () => {
    mockBranding.icon = ICON;
    const html = mark({ variant: 'gradient' });
    expect(html).toContain('data-brand-mark="icon"');
    expect(html).toContain(`src="${ICON}"`);
    expect(html).toContain('object-contain');
    expect(html).not.toContain('>M<');
    expect(html).not.toContain('linear-gradient');
    expect(html).toContain('var(--hub-ok)');
  });

  it('omits the status dot when asked', () => {
    mockBranding.icon = ICON;
    expect(mark({ variant: 'ink', statusDot: false })).not.toContain('var(--hub-ok)');
  });
});

describe('useBrandLogo', () => {
  it('returns nothing when no logo is set, even if an icon is', () => {
    mockBranding.icon = ICON;
    expect(logo()).toBe('');
  });

  it('picks the logo for the current theme and falls dark back to light', () => {
    mockBranding.logoLight = LIGHT;
    expect(logo()).toBe(LIGHT);
    mockTheme = 'dark';
    expect(logo()).toBe(LIGHT);
    mockBranding.logoDark = DARK;
    expect(logo()).toBe(DARK);
  });

  it('does not show a dark-only logo in light theme', () => {
    mockBranding.logoDark = DARK;
    expect(logo()).toBe('');
  });
});

describe('dataUrlBytes', () => {
  it('measures the decoded payload', () => {
    expect(dataUrlBytes('data:image/png;base64,AAAA')).toBe(3);
    expect(dataUrlBytes('data:image/png;base64,AAA=')).toBe(2);
    expect(dataUrlBytes('data:image/png;base64,AA==')).toBe(1);
  });
});
