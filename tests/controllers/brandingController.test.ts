import { Request, Response } from 'express';

const getSystemConfigMock = jest.fn();
jest.mock('../../src/dao/DaoFactory.js', () => ({
  getSystemConfigDao: jest.fn(() => ({ get: getSystemConfigMock })),
}));
jest.mock('../../src/utils/systemConfigCache.js', () => ({
  getCachedSystemConfig: jest.fn(() => null),
}));

import { getBrandingImage } from '../../src/controllers/brandingController.js';
import { publicBranding } from '../../src/utils/brandingImage.js';

const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('px')]);
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const url = (mime: string, bytes: Buffer) => `data:${mime};base64,${bytes.toString('base64')}`;

const run = async (slot: string, headers: Record<string, string> = {}) => {
  const sent: { status?: number; headers: Record<string, string>; body?: unknown; json?: unknown } = {
    headers: {},
  };
  const res = {
    setHeader: (k: string, v: string) => void (sent.headers[k.toLowerCase()] = v),
    status: (code: number) => {
      sent.status = code;
      return res;
    },
    json: (body: unknown) => void (sent.json = body),
    end: (body?: unknown) => void (sent.body = body),
  } as unknown as Response;
  await getBrandingImage({ params: { slot }, headers } as unknown as Request, res);
  return sent;
};

beforeEach(() => {
  getSystemConfigMock.mockResolvedValue({
    dashboardBranding: { icon: url('image/png', png), logoLight: url('image/svg+xml', svg) },
  });
});

describe('GET /api/branding/:slot', () => {
  it('serves the raw bytes with type, nosniff, a strong ETag and a year-long immutable cache', async () => {
    const sent = await run('icon');
    expect(sent.status).toBe(200);
    expect((sent.body as Buffer).equals(png)).toBe(true);
    expect(sent.headers['content-type']).toBe('image/png');
    expect(sent.headers['x-content-type-options']).toBe('nosniff');
    expect(sent.headers['etag']).toMatch(/^"[0-9a-f]{64}"$/);
    expect(sent.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(sent.headers['content-security-policy']).toBeUndefined();
  });

  it('locks SVG down with a CSP and sandbox', async () => {
    const sent = await run('logoLight');
    expect(sent.headers['content-type']).toBe('image/svg+xml');
    expect(sent.headers['content-security-policy']).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    );
    expect(sent.headers['x-content-type-options']).toBe('nosniff');
  });

  it('answers 304 for a matching If-None-Match and 200 for a stale one', async () => {
    const etag = (await run('icon')).headers['etag'];
    const hit = await run('icon', { 'if-none-match': etag });
    expect(hit.status).toBe(304);
    expect(hit.body).toBeUndefined();
    expect(hit.headers['etag']).toBe(etag);
    expect((await run('icon', { 'if-none-match': '"other"' })).status).toBe(200);
    expect((await run('icon', { 'if-none-match': `"x", W/${etag}` })).status).toBe(304);
  });

  it.each(['logoDark', 'favicon', '__proto__'])('returns a JSON 404 for %s', async (slot) => {
    const sent = await run(slot);
    expect(sent.status).toBe(404);
    expect(sent.json).toEqual(expect.objectContaining({ success: false }));
    expect(sent.headers['cache-control']).toBe('no-cache');
  });

  it('returns 404 for a stored value that is not a valid image', async () => {
    getSystemConfigMock.mockResolvedValue({ dashboardBranding: { icon: 'https://example.com/a.png' } });
    expect((await run('icon')).status).toBe(404);
  });

  it('changes the ETag and the public URL version when the image is replaced', async () => {
    const before = (await run('icon')).headers['etag'];
    const urlBefore = publicBranding({ icon: url('image/png', png) }, '').icon;
    const next = Buffer.concat([png, Buffer.from('v2')]);
    getSystemConfigMock.mockResolvedValue({ dashboardBranding: { icon: url('image/png', next) } });
    expect((await run('icon')).headers['etag']).not.toBe(before);
    expect(publicBranding({ icon: url('image/png', next) }, '').icon).not.toBe(urlBefore);
  });
});
