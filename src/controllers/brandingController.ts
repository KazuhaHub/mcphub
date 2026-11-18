import { Request, Response } from 'express';
import { getSystemConfigDao } from '../dao/DaoFactory.js';
import { getCachedSystemConfig } from '../utils/systemConfigCache.js';
import { BRANDING_SLOTS, BrandingSlot, getBrandingAsset } from '../utils/brandingImage.js';
import { logger } from '../utils/logger.js';

const notFound = (res: Response, message: string): void => {
  res.setHeader('Cache-Control', 'no-cache');
  res.status(404).json({ success: false, message });
};

const matchesEtag = (header: string | undefined, etag: string): boolean =>
  !!header &&
  (header.trim() === '*' ||
    header.split(',').some((candidate) => candidate.trim().replace(/^W\//, '') === etag));

/**
 * Serves one uploaded branding image without authentication. The public config links here
 * with a content-derived `v` query, so the response can be cached for a year.
 */
export const getBrandingImage = async (req: Request, res: Response): Promise<void> => {
  const slot = req.params.slot as BrandingSlot;
  if (!(BRANDING_SLOTS as readonly string[]).includes(slot)) {
    notFound(res, 'Unknown branding image');
    return;
  }
  try {
    const systemConfig = getCachedSystemConfig() ?? (await getSystemConfigDao().get());
    const asset = getBrandingAsset(systemConfig?.dashboardBranding, slot);
    if (!asset) {
      notFound(res, 'Branding image not set');
      return;
    }

    const etag = `"${asset.sha256}"`;
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
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
