import { OAuthServerConfig } from '../types/index.js';

export const DEFAULT_OAUTH_SERVER_CONFIG: OAuthServerConfig = {
  alwaysShowApprovalScreen: true,
  approvalLifetime: 1209600,
  enabled: true,
  accessTokenLifetime: 3600,
  refreshTokenLifetime: 1209600,
  authorizationCodeLifetime: 300,
  requireClientSecret: false,
  allowedScopes: ['read', 'write'],
  requireState: false,
  dynamicRegistration: {
    enabled: true,
    allowedGrantTypes: ['authorization_code', 'refresh_token'],
    requiresAuthentication: false,
    clientTtl: 2592000, // 30 days: reap idle dynamically-registered clients with no live tokens
  },
  clientIdMetadata: {
    enabled: true,
    cacheTtlMs: 3_600_000,
  },
};

/**
 * Whether Client ID Metadata Documents are resolved. An explicit boolean in the stored
 * config wins; otherwise the default applies (also when clientIdMetadata only sets cacheTtlMs).
 */
export const isCimdEnabled = (oauthServer?: Partial<OAuthServerConfig> | null): boolean => {
  const enabled = oauthServer?.clientIdMetadata?.enabled;
  return typeof enabled === 'boolean'
    ? enabled
    : DEFAULT_OAUTH_SERVER_CONFIG.clientIdMetadata?.enabled === true;
};

export const cloneDefaultOAuthServerConfig = (): OAuthServerConfig => {
  const allowedScopes = DEFAULT_OAUTH_SERVER_CONFIG.allowedScopes
    ? [...DEFAULT_OAUTH_SERVER_CONFIG.allowedScopes]
    : [];

  const baseDynamicRegistration = DEFAULT_OAUTH_SERVER_CONFIG.dynamicRegistration ?? {
    enabled: false,
    allowedGrantTypes: [],
    requiresAuthentication: false,
  };

  const dynamicRegistration = {
    ...baseDynamicRegistration,
    allowedGrantTypes: baseDynamicRegistration.allowedGrantTypes
      ? [...baseDynamicRegistration.allowedGrantTypes]
      : [],
  };

  return {
    ...DEFAULT_OAUTH_SERVER_CONFIG,
    allowedScopes,
    dynamicRegistration,
    clientIdMetadata: { ...DEFAULT_OAUTH_SERVER_CONFIG.clientIdMetadata },
  };
};
