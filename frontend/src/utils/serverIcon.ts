import { fetchWithInterceptors } from './fetchInterceptor';
import { BRANDING_ACCEPT, prepareBrandingImage, type PrepareResult } from './brandingImage';

// Server icons follow the dashboard branding rules: PNG, JPEG, WebP or SVG, at most 256 KB.
export const SERVER_ICON_ACCEPT = BRANDING_ACCEPT;
export const SERVER_ICON_MAX_SIDE = 256;

/** Reads a chosen file into a data URL the server accepts, scaling large bitmaps down. */
export const prepareServerIcon = (file: File): Promise<PrepareResult> =>
  prepareBrandingImage(file, SERVER_ICON_MAX_SIDE);

/** The first character of a name, upper-cased, for the fallback tile. */
export const serverInitial = (name: string): string => {
  const first = Array.from(name.trim())[0];
  return first ? first.toLocaleUpperCase() : '?';
};

// Icons are only served to signed-in users, with the auth header an <img> cannot send, so the
// bytes are fetched once per versioned URL and shown from a data: URL. The URL carries a hash
// of the bytes, so a replaced icon is a new entry. Failures are not cached.
const cache = new Map<string, Promise<string | null>>();

// A data: URL, not a blob: URL. A blob: URL has the dashboard's origin, so opening the image in
// a new tab would run an SVG's script there (with the sign-in token in reach); a data: document
// has an opaque origin and browsers block navigating to it from the page.
const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

export const loadServerIcon = (url: string): Promise<string | null> => {
  const cached = cache.get(url);
  if (cached) return cached;
  const pending = (async () => {
    try {
      const response = await fetchWithInterceptors(url);
      if (!response.ok) return null;
      const type = response.headers.get('content-type') ?? '';
      if (!/^image\/(?:png|jpeg|webp|svg\+xml)$/.test(type)) return null;
      return await blobToDataUrl(await response.blob());
    } catch {
      return null;
    }
  })();
  cache.set(url, pending);
  void pending.then((result) => {
    if (result === null) cache.delete(url);
  });
  return pending;
};

/** Test hook: forgets every fetched icon. */
export const clearServerIconCache = (): void => cache.clear();
