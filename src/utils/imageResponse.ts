import type { Request, Response } from 'express';
import type { BrandingAsset } from './brandingImage.js';

export const matchesEtag = (header: string | undefined, etag: string): boolean =>
  !!header &&
  (header.trim() === '*' ||
    header.split(',').some((candidate) => candidate.trim().replace(/^W\//, '') === etag));

/** The `v` query is the first 12 hex characters of the image's SHA-256. */
export const versionMatches = (asset: BrandingAsset | null, version: string): boolean =>
  asset !== null && /^[0-9a-f]{12}$/.test(version) && asset.sha256.startsWith(version);

export const notFound = (res: Response, message: string): void => {
  res.setHeader('Cache-Control', 'no-cache');
  res.status(404).json({ success: false, message });
};

/**
 * Sends one uploaded image. The year-long immutable cache is sent only when the bytes served
 * really are the version asked for, so a lagging config cache (replica mode) can never store
 * old bytes under a new URL. `shared` false marks the response private to the requesting
 * user's browser (an image only some users may see must not be kept by a shared cache).
 */
export const sendImageAsset = (
  req: Request,
  res: Response,
  asset: BrandingAsset,
  requested: string | undefined,
  shared: boolean,
): void => {
  const etag = `"${asset.sha256}"`;
  res.setHeader('ETag', etag);
  if (requested === undefined) {
    res.setHeader('Cache-Control', shared ? 'no-cache' : 'private, no-cache');
  } else if (versionMatches(asset, requested)) {
    res.setHeader(
      'Cache-Control',
      `${shared ? 'public' : 'private'}, max-age=31536000, immutable`,
    );
  } else {
    // A stale or unknown version: still show the current image, but never store it.
    res.setHeader('Cache-Control', 'no-store');
  }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (asset.mime === 'image/svg+xml') {
    // Opening the SVG directly must not run scripts.
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  }
  if (matchesEtag(req.headers['if-none-match'], etag)) {
    res.status(304).end();
    return;
  }
  res.setHeader('Content-Type', asset.mime);
  res.setHeader('Content-Length', String(asset.bytes.length));
  res.status(200).end(asset.bytes);
};
