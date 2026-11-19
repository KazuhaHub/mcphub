import type { Router } from 'express';
import { check } from 'express-validator';
import { login } from '../controllers/authController.js';
import { authAttemptRateLimiter } from '../utils/rateLimit.js';

/**
 * POST /auth/login, the only password sign-in endpoint (the dashboard, the CLI and the break-glass
 * admin entry all use it). Kept in its own module so tests mount exactly this route definition:
 * validators, then the login limiter, then the controller.
 */
export const mountPasswordLoginRoute = (router: Router): void => {
  router.post(
    '/auth/login',
    [
      check('username', 'Username is required').not().isEmpty(),
      check('password', 'Password is required').not().isEmpty(),
    ],
    authAttemptRateLimiter,
    login,
  );
};
