export const BRANDING_MAX_BYTES = 256 * 1024;
export const BRANDING_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'] as const;
export const BRANDING_ACCEPT = BRANDING_TYPES.join(',');

export type BrandingSlot = 'icon' | 'logoLight' | 'logoDark';
export type BrandingImages = Record<BrandingSlot, string>;

export const EMPTY_BRANDING: BrandingImages = { icon: '', logoLight: '', logoDark: '' };

export type PrepareResult = { ok: true; dataUrl: string } | { ok: false; error: 'type' | 'size' | 'read' };

// Decoded size of a base64 data URL.
export const dataUrlBytes = (dataUrl: string): number => {
  const payload = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  return Math.floor((payload.length * 3) / 4) - padding;
};

const readAsDataUrl = (file: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('decode failed'));
    image.src = src;
  });

// Re-encodes a raster image no larger than maxSide pixels on its longest edge.
const downscale = async (dataUrl: string, type: string, maxSide: number): Promise<string> => {
  const image = await loadImage(dataUrl);
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('no canvas');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL(type, 0.9);
};

/**
 * Turns a chosen file into a data URL the server accepts. Raster images over the size limit
 * are scaled down once (longest edge `maxSide`); SVG and still-too-large images are rejected.
 */
export const prepareBrandingImage = async (file: File, maxSide: number): Promise<PrepareResult> => {
  if (!(BRANDING_TYPES as readonly string[]).includes(file.type)) return { ok: false, error: 'type' };
  try {
    let dataUrl = await readAsDataUrl(file);
    if (file.size > BRANDING_MAX_BYTES && file.type !== 'image/svg+xml') {
      dataUrl = await downscale(dataUrl, file.type, maxSide);
    }
    // Accept the type the encoder actually produced: some browsers (Safari) return PNG when
    // asked for WebP.
    if (!/^data:image\/(?:png|jpeg|webp|svg\+xml);base64,/.test(dataUrl)) {
      return { ok: false, error: 'type' };
    }
    return dataUrlBytes(dataUrl) > BRANDING_MAX_BYTES
      ? { ok: false, error: 'size' }
      : { ok: true, dataUrl };
  } catch {
    return { ok: false, error: 'read' };
  }
};
