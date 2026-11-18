import { prepareBrandingImage, BRANDING_MAX_BYTES } from '../../frontend/src/utils/brandingImage';

const g = globalThis as any;
const realFileReader = g.FileReader;
const realImage = g.Image;
const realDocument = g.document;

const b64 = (bytes: number) => Buffer.alloc(bytes, 1).toString('base64');

const stubBrowser = (encoded: string) => {
  g.FileReader = class {
    result = '';
    onload: (() => void) | null = null;
    readAsDataURL(file: { type: string; size: number }) {
      this.result = `data:${file.type};base64,${b64(file.size)}`;
      setTimeout(() => this.onload?.(), 0);
    }
  };
  g.Image = class {
    naturalWidth = 2000;
    naturalHeight = 1000;
    onload: (() => void) | null = null;
    set src(_value: string) {
      setTimeout(() => this.onload?.(), 0);
    }
  };
  g.document = {
    createElement: () => ({
      getContext: () => ({ drawImage: () => undefined }),
      toDataURL: () => encoded,
    }),
  };
};

afterEach(() => {
  g.FileReader = realFileReader;
  g.Image = realImage;
  g.document = realDocument;
});

const file = (type: string, size: number) => ({ type, size }) as unknown as File;

describe('prepareBrandingImage', () => {
  it('rejects types outside the allowed four', async () => {
    expect(await prepareBrandingImage(file('image/gif', 10), 256)).toEqual({ ok: false, error: 'type' });
  });

  it('passes a small image through unchanged', async () => {
    stubBrowser('');
    const result = await prepareBrandingImage(file('image/png', 10), 256);
    expect(result).toMatchObject({ ok: true });
  });

  it('rejects an oversize SVG without downscaling', async () => {
    stubBrowser('');
    expect(await prepareBrandingImage(file('image/svg+xml', BRANDING_MAX_BYTES + 1), 256)).toEqual({
      ok: false,
      error: 'size',
    });
  });

  it('accepts the encoder output type when a browser answers PNG for a WebP request', async () => {
    stubBrowser(`data:image/png;base64,${b64(1000)}`);
    const result = await prepareBrandingImage(file('image/webp', BRANDING_MAX_BYTES + 1), 256);
    expect(result).toMatchObject({ ok: true });
    expect((result as { dataUrl: string }).dataUrl.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('still rejects a downscaled image that stays too large', async () => {
    stubBrowser(`data:image/jpeg;base64,${b64(BRANDING_MAX_BYTES + 10)}`);
    expect(await prepareBrandingImage(file('image/jpeg', BRANDING_MAX_BYTES + 1), 256)).toEqual({
      ok: false,
      error: 'size',
    });
  });

  it('rejects an encoder output of an unsupported type', async () => {
    stubBrowser('data:image/bmp;base64,AAAA');
    expect(await prepareBrandingImage(file('image/png', BRANDING_MAX_BYTES + 1), 256)).toEqual({
      ok: false,
      error: 'type',
    });
  });
});
