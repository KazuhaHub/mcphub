import { BrandingAsset, decodeImageDataUrl, validateBrandingImage } from './brandingImage.js';
import { ServerConfigValidationError } from './serverConfigValidation.js';

// Per-server icons reuse the dashboard branding image rules: a base64 data: URL of type
// PNG, JPEG, WebP or SVG, at most 256 KB decoded, never a remote URL.

/**
 * The icon to store: undefined for an unset, null or empty value (which clears it), the
 * data URL for a valid one. Anything else is rejected.
 */
export const normalizeServerIcon = (value: unknown): string | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  const error = validateBrandingImage(value);
  if (error) throw new ServerConfigValidationError(`icon ${error}`);
  return value as string;
};

/** A stored icon read leniently: an invalid one is dropped, never fatal. */
export const readStoredServerIcon = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' && validateBrandingImage(value) === null
    ? value
    : undefined;

const MAX_CACHED = 500;
// One decoded entry per server, reused while the stored value is unchanged, so serving the
// image and listing servers do not decode and hash it on every request.
const assetCache = new Map<string, { source: string; asset: BrandingAsset | null }>();

/** Decodes a server's stored icon, or returns null when it has none or it is invalid. */
export const getServerIconAsset = (name: string, icon: unknown): BrandingAsset | null => {
  if (typeof icon !== 'string' || icon === '') return null;
  const cached = assetCache.get(name);
  if (cached && cached.source === icon) return cached.asset;
  const asset = decodeImageDataUrl(icon);
  assetCache.delete(name);
  assetCache.set(name, { source: icon, asset });
  if (assetCache.size > MAX_CACHED) {
    const oldest = assetCache.keys().next().value;
    if (oldest !== undefined) assetCache.delete(oldest);
  }
  return asset;
};

/**
 * The versioned same-origin URL of a server's icon, or undefined when it has none. The `v`
 * query derives from the image bytes, so a replaced icon gets a new URL and the long cache
 * lifetime stays safe.
 */
export const serverIconUrl = (
  name: string,
  icon: unknown,
  basePath: string,
): string | undefined => {
  const asset = getServerIconAsset(name, icon);
  return asset
    ? `${basePath}/api/servers/${encodeURIComponent(name)}/icon?v=${asset.sha256.slice(0, 12)}`
    : undefined;
};

/**
 * A copy of a server config that is safe to return from the API: the stored image data is
 * replaced by its URL (or dropped when invalid). Exports keep the data.
 */
export const withServerIconUrl = <T extends { icon?: unknown }>(
  name: string,
  config: T,
  basePath: string,
): T => {
  if (config.icon === undefined || config.icon === null) return config;
  const { icon, ...rest } = config;
  const url = serverIconUrl(name, icon, basePath);
  return (url ? { ...rest, icon: url } : rest) as T;
};
