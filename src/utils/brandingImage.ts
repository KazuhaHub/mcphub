import { createHash } from 'crypto';
import type { DashboardBranding } from '../types/index.js';

export const BRANDING_SLOTS = ['icon', 'logoLight', 'logoDark'] as const;
export type BrandingSlot = (typeof BRANDING_SLOTS)[number];

export const BRANDING_MAX_BYTES = 256 * 1024;

const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'] as const;
type BrandingMime = (typeof ALLOWED_TYPES)[number];

const DATA_URL = /^data:(image\/(?:png|jpeg|webp|svg\+xml));base64,([A-Za-z0-9+/]*={0,2})$/;
// Longest possible base64 text for the byte limit; checked first so an oversized value is
// rejected without running the regular expression over it.
const MAX_ENCODED_LENGTH = Math.ceil(BRANDING_MAX_BYTES / 3) * 4;

const hasSignature = (type: BrandingMime, bytes: Buffer): boolean => {
  switch (type) {
    case 'image/png':
      return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case 'image/jpeg':
      return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case 'image/webp':
      return (
        bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
        bytes.subarray(8, 12).toString('latin1') === 'WEBP'
      );
    case 'image/svg+xml':
      return /<svg[\s>]/i.test(bytes.toString('utf8'));
  }
};

/**
 * Validates one branding image. Returns an error message, or null when the value is an
 * allowed base64 `data:` URL (PNG, JPEG, WebP or SVG, at most 256 KB decoded). The empty
 * string is valid and means "clear the image".
 */
export const validateBrandingImage = (value: unknown): string | null => {
  if (typeof value !== 'string') return 'must be a string';
  if (value === '') return null;
  if (!value.startsWith('data:')) {
    return 'must be a base64 data: URL (remote URLs are not allowed)';
  }
  const comma = value.indexOf(',');
  if (comma === -1 || comma > 64) return 'must be a base64 data: URL';
  if (value.length - comma - 1 > MAX_ENCODED_LENGTH) {
    return `must be at most ${BRANDING_MAX_BYTES / 1024} KB`;
  }
  const match = DATA_URL.exec(value);
  if (!match) {
    const mime = /^data:([^;,]*)/.exec(value)?.[1] ?? '';
    return ALLOWED_TYPES.includes(mime as BrandingMime) && value.slice(0, comma).endsWith(';base64')
      ? 'is not valid base64'
      : 'must be a base64 data: URL of type image/png, image/jpeg, image/webp or image/svg+xml';
  }
  const [, mime, payload] = match;
  if (payload.length === 0 || payload.length % 4 !== 0) return 'is not valid base64';
  const bytes = Buffer.from(payload, 'base64');
  if (bytes.length > BRANDING_MAX_BYTES) {
    return `must be at most ${BRANDING_MAX_BYTES / 1024} KB`;
  }
  if (!hasSignature(mime as BrandingMime, bytes)) {
    return `content does not look like ${mime}`;
  }
  return null;
};

/**
 * Validates a partial branding update. Each provided slot is validated; unknown keys are
 * rejected. Returns an error message or null.
 */
export const validateBrandingUpdate = (value: unknown): string | null => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return 'dashboardBranding must be an object';
  }
  for (const key of Object.keys(value)) {
    if (!(BRANDING_SLOTS as readonly string[]).includes(key)) {
      return `dashboardBranding.${key} is not a supported image slot`;
    }
  }
  for (const slot of BRANDING_SLOTS) {
    const slotValue = (value as Record<string, unknown>)[slot];
    if (slotValue === undefined) continue;
    const error = validateBrandingImage(slotValue);
    if (error) return `dashboardBranding.${slot} ${error}`;
  }
  return null;
};

/** Merges a validated update into the stored branding; an empty string clears a slot. */
export const mergeBranding = (
  current: DashboardBranding | undefined,
  update: Partial<Record<BrandingSlot, string>>,
): DashboardBranding => {
  const next: DashboardBranding = { ...(current ?? {}) };
  for (const slot of BRANDING_SLOTS) {
    const value = update[slot];
    if (value === undefined) continue;
    if (value === '') delete next[slot];
    else next[slot] = value;
  }
  return next;
};

export interface BrandingAsset {
  mime: string;
  bytes: Buffer;
  /** Hex SHA-256 of the decoded bytes. */
  sha256: string;
}

// One decoded entry per slot, reused while the stored value is unchanged, so serving the
// image and building the public config do not decode and hash it on every request.
const assetCache = new Map<BrandingSlot, { source: string; asset: BrandingAsset | null }>();

/** Decodes a stored slot value, or returns null when it is unset or invalid. */
export const getBrandingAsset = (
  branding: DashboardBranding | undefined,
  slot: BrandingSlot,
): BrandingAsset | null => {
  const source = branding?.[slot];
  if (typeof source !== 'string' || source === '') return null;
  const cached = assetCache.get(slot);
  if (cached && cached.source === source) return cached.asset;
  let asset: BrandingAsset | null = null;
  if (validateBrandingImage(source) === null) {
    const match = DATA_URL.exec(source);
    if (match) {
      const bytes = Buffer.from(match[2], 'base64');
      asset = { mime: match[1], bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
    }
  }
  assetCache.set(slot, { source, asset });
  return asset;
};

/**
 * The public branding URLs, one per slot ('' when unset). The `v` query is derived from the
 * image bytes, so a replaced image gets a new URL and the long cache lifetime stays safe.
 */
export const publicBranding = (
  branding: DashboardBranding | undefined,
  basePath: string,
): Required<DashboardBranding> => {
  const out: Required<DashboardBranding> = { icon: '', logoLight: '', logoDark: '' };
  for (const slot of BRANDING_SLOTS) {
    const asset = getBrandingAsset(branding, slot);
    if (asset) out[slot] = `${basePath}/api/branding/${slot}?v=${asset.sha256.slice(0, 12)}`;
  }
  return out;
};
