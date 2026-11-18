import { Request, Response } from 'express';
import { getSystemConfigDao } from '../dao/DaoFactory.js';
import { getCachedSystemConfig } from '../utils/systemConfigCache.js';
import {
  BRANDING_SLOTS,
  BrandingAsset,
  BrandingSlot,
  getBrandingAsset,
} from '../utils/brandingImage.js';
import { logger } from '../utils/logger.js';

const notFound = (res: Response, message: string): void => {
  res.setHeader('Cache-Control', 'no-cache');
  res.status(404).json({ success: false, message });
};

const matchesEtag = (header: string | undefined, etag: string): boolean =>
  !!header &&
  (header.trim() === '*' ||
    header.split(',').some((candidate) => candidate.trim().replace(/^W\//, '') === etag));

const versionMatches = (asset: BrandingAsset | null, version: string): boolean =>
  asset !== null && /^[0-9a-f]{12}$/.test(version) && asset.sha256.startsWith(version);

/**
 * Serves one uploaded branding image without authentication. The public config links here
 * with a content-derived `v` query. The year-long immutable cache is sent only when the
 * bytes served really are the version asked for, so a lagging config cache (replica mode)
 * can never store old bytes under a new URL.
 */
export const getBrandingImage = async (req: Request, res: Response): Promise<void> => {
  const slot = req.params.slot as BrandingSlot;
  if (!(BRANDING_SLOTS as readonly string[]).includes(slot)) {
    notFound(res, 'Unknown branding image');
    return;
  }
  try {
    const requested = typeof req.query?.v === 'string' ? req.query.v : undefined;
    const cached = getCachedSystemConfig();
    let asset = getBrandingAsset(cached?.dashboardBranding, slot);
    // The in-memory copy can lag the database: re-read it when the caller asks for another
    // version than the one it holds, or when it holds nothing for this slot.
    if (!cached || (requested !== undefined && !versionMatches(asset, requested)) || !asset) {
      const fresh = await getSystemConfigDao().get();
      asset = getBrandingAsset(fresh?.dashboardBranding, slot);
    }
    if (!asset) {
      notFound(res, 'Branding image not set');
      return;
    }

    const etag = `"${asset.sha256}"`;
    res.setHeader('ETag', etag);
    if (requested === undefined) {
      res.setHeader('Cache-Control', 'no-cache');
    } else if (versionMatches(asset, requested)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else {
      // A stale or unknown version: still show the current image, but never store it.
      res.setHeader('Cache-Control', 'no-store');
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (asset.mime === 'image/svg+xml') {
      // Opening the SVG directly must not run scripts.
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      );
    }
    if (matchesEtag(req.headers['if-none-match'], etag)) {
      res.status(304).end();
      return;
    }
    res.setHeader('Content-Type', asset.mime);
    res.setHeader('Content-Length', String(asset.bytes.length));
    res.status(200).end(asset.bytes);
  } catch (error) {
    logger.error('Error serving branding image:', error);
    res.status(500).json({ success: false, message: 'Failed to load branding image' });
  }
};
