import { Request, Response } from 'express';
import { getSystemConfigDao } from '../dao/DaoFactory.js';
import { getCachedSystemConfig } from '../utils/systemConfigCache.js';
import { BRANDING_SLOTS, BrandingSlot, getBrandingAsset } from '../utils/brandingImage.js';
import { notFound, sendImageAsset, versionMatches } from '../utils/imageResponse.js';
import { logger } from '../utils/logger.js';

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

    sendImageAsset(req, res, asset, requested, true);
  } catch (error) {
    logger.error('Error serving branding image:', error);
    res.status(500).json({ success: false, message: 'Failed to load branding image' });
  }
};
