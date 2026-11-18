import { DASHBOARD_TOKEN_EXPIRY, getUserSessionVersion } from '../utils/userSession.js';
import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { validationResult } from 'express-validator';
import {
  findUserByUsername,
  verifyPassword,
  createUser,
  updateUserPassword,
} from '../models/User.js';
import { getSystemConfigDao } from '../dao/DaoFactory.js';
import { isRegistrationUsernameReserved } from '../services/registrationService.js';
import { getDataService } from '../services/services.js';
import { DataService } from '../services/dataService.js';
import { JWT_SECRET } from '../config/jwt.js';
import { validatePasswordStrength, isDefaultPassword } from '../utils/passwordValidation.js';
import { getPackageVersion } from '../utils/version.js';
import { logger } from '../utils/logger.js';
import {
  getBetterAuthRuntimeConfig,
  getPasswordLoginPolicy,
} from '../services/betterAuthConfig.js';
import { IUser } from '../types/index.js';

const dataService: DataService = getDataService();

const TOKEN_EXPIRY = DASHBOARD_TOKEN_EXPIRY;

// A bcrypt hash (cost 10, like stored passwords) of a random value nobody knows. Comparing against
// it costs the same as checking a real password, so a missing account answers as slowly as a wrong
// password does.
const DUMMY_PASSWORD_HASH = '$2b$10$3mgNTl6h1CrE8eIQBu9H1OXwIqkJE1YtOfu5z0k9Ixy1QUqeeeHqe';

const checkPassword = async (password: unknown, hash: string | undefined): Promise<boolean> => {
  const plain = typeof password === 'string' ? password : '';
  try {
    const valid = await verifyPassword(plain, hash || DUMMY_PASSWORD_HASH);
    return valid && Boolean(hash) && plain.length > 0;
  } catch {
    // A malformed stored hash (for example an SSO-only account) never matches
    return false;
  }
};

const sendLoginSuccess = (
  res: Response,
  t: (key: string) => string,
  user: IUser,
  password: string,
) => {
  const payload = {
    user: {
      username: user.username,
      sessionVersion: getUserSessionVersion(user),
      isAdmin: user.isAdmin || false,
    },
  };

  // Check if user is admin with default password
  const version = getPackageVersion();
  const isUsingDefaultPassword =
    user.username === 'admin' && user.isAdmin && isDefaultPassword(password) && version !== 'dev';

  jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRY }, (err, token) => {
    if (err) throw err;
    res.json({
      success: true,
      message: t('api.success.login_successful'),
      token,
      user: {
        username: user.username,
        isAdmin: user.isAdmin,
        permissions: dataService.getPermissions(user),
      },
      isUsingDefaultPassword,
    });
  });
};

// Login user
export const login = async (req: Request, res: Response): Promise<void> => {
  // Get translation function from request
  const t = (req as any).t;

  try {
    const policy = await getPasswordLoginPolicy();

    if (policy !== 'all') {
      // Password login is disabled. Only the break-glass setting lets admin accounts in. Every
      // failure gets the same 403 after the same lookup and bcrypt work, whether the setting is on
      // or off, the account is missing, not an admin, or the password is wrong, so a probe learns
      // neither the setting nor which accounts exist or are admins.
      const { username, password } = req.body ?? {};
      const user =
        typeof username === 'string' && username ? await findUserByUsername(username) : undefined;
      const valid = await checkPassword(password, user?.password);
      if (policy !== 'admins' || !user || !valid || user.isAdmin !== true) {
        res.status(403).json({ success: false, message: t('api.errors.password_login_disabled') });
        return;
      }
      logger.warn(
        `Break-glass password sign-in: admin ${JSON.stringify(user.username)} from ${req.ip} while password login is disabled`,
      );
      sendLoginSuccess(res, t, user, password);
      return;
    }

    // Validate request
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({
        success: false,
        message: t('api.errors.validation_failed'),
        errors: errors.array(),
      });
      return;
    }

    const { username, password } = req.body;
    const user = await findUserByUsername(username);
    const isPasswordValid = await checkPassword(password, user?.password);

    if (!user || !isPasswordValid) {
      res.status(401).json({
        success: false,
        message: t('api.errors.invalid_credentials'),
      });
      return;
    }

    sendLoginSuccess(res, t, user, password);
  } catch (error) {
    logger.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: t('api.errors.server_error'),
    });
  }
};

// Register new user
export const register = async (req: Request, res: Response): Promise<void> => {
  // Get translation function from request
  const t = (req as any).t;

  // Validate request
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({
      success: false,
      message: t('api.errors.validation_failed'),
      errors: errors.array(),
    });
    return;
  }

  const { username, password } = req.body;

  try {
    const systemConfig = await getSystemConfigDao().get();
    const runtime = await getBetterAuthRuntimeConfig(systemConfig);
    if (systemConfig?.auth?.allowRegistration !== true || runtime.disablePasswordLogin) {
      res.status(403).json({ success: false, message: t('auth.error.signup_disabled') });
      return;
    }
    const strength = validatePasswordStrength(password);
    if (!strength.isValid) {
      res.status(400).json({
        success: false,
        message: t('auth.passwordStrengthError'),
        errors: strength.errors,
      });
      return;
    }
    if (await isRegistrationUsernameReserved(username)) {
      res.status(400).json({ success: false, message: t('auth.userAlreadyExists') });
      return;
    }
    // Create new user
    const newUser = await createUser({ username, password, isAdmin: false });

    if (!newUser) {
      res.status(400).json({ success: false, message: t('auth.userAlreadyExists') });
      return;
    }

    // Generate JWT token
    const payload = {
      user: {
        username: newUser.username,
        sessionVersion: getUserSessionVersion(newUser),
        isAdmin: newUser.isAdmin || false,
      },
    };

    jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRY }, (err, token) => {
      if (err) throw err;
      res.json({
        success: true,
        token,
        user: {
          username: newUser.username,
          isAdmin: newUser.isAdmin,
          permissions: dataService.getPermissions(newUser),
        },
      });
    });
  } catch (error) {
    logger.error('Registration error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Get current user
export const getCurrentUser = (req: Request, res: Response): void => {
  try {
    // User is already attached to request by auth middleware
    const user = (req as any).user;

    res.json({
      success: true,
      user: {
        username: user.username,
        isAdmin: user.isAdmin,
        permissions: dataService.getPermissions(user),
      },
    });
  } catch (error) {
    logger.error('Get current user error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Change password
export const changePassword = async (req: Request, res: Response): Promise<void> => {
  // Validate request
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ success: false, errors: errors.array() });
    return;
  }

  const { currentPassword, newPassword } = req.body;
  const username = (req as any).user.username;

  try {
    // Validate new password strength
    const validationResult = validatePasswordStrength(newPassword);
    if (!validationResult.isValid) {
      res.status(400).json({
        success: false,
        message: 'Password does not meet security requirements',
        errors: validationResult.errors,
      });
      return;
    }

    // Find user by username
    const user = await findUserByUsername(username);

    if (!user) {
      res.status(404).json({ success: false, message: 'User not found' });
      return;
    }

    // Verify current password
    const isPasswordValid = await verifyPassword(currentPassword, user.password);

    if (!isPasswordValid) {
      res.status(401).json({ success: false, message: 'Current password is incorrect' });
      return;
    }

    // Update the password
    const updated = await updateUserPassword(username, newPassword);

    if (!updated) {
      res.status(500).json({ success: false, message: 'Failed to update password' });
      return;
    }

    res.json({ success: true, message: 'Password updated successfully' });
  } catch (error) {
    logger.error('Change password error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
