import type { Request, Response } from 'express';
import { getServerDao } from '../dao/DaoFactory.js';
import { authorizationService, RequestPrincipal } from '../services/authorizationService.js';
import { getServerIconAsset } from '../utils/serverIcon.js';
import { notFound, sendImageAsset } from '../utils/imageResponse.js';
import { logger } from '../utils/logger.js';

/**
 * Serves one server's uploaded icon to a signed-in user who may see that server (the same
 * visibility rule as the server list). An unknown server, a server the caller cannot see and
 * a server without an icon all answer the same 404, so the route never reveals which servers
 * exist. The response is private: a shared cache must not hand it to someone else.
 */
export const getServerIcon = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = (req as Request & { user?: RequestPrincipal }).user;
    const server = await getServerDao().findById(req.params.name);
    const asset =
      server && user && authorizationService.can('server.discover', server, user)
        ? getServerIconAsset(server.name, server.icon)
        : null;
    if (!asset) {
      notFound(res, 'Icon not found');
      return;
    }
    const requested = typeof req.query?.v === 'string' ? req.query.v : undefined;
    sendImageAsset(req, res, asset, requested, false);
  } catch (error) {
    logger.error('Error serving server icon:', error);
    res.status(500).json({ success: false, message: 'Failed to load server icon' });
  }
};
