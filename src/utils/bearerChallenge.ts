import type { Request } from 'express';
import type { SystemConfig } from '../types/index.js';
import { cloneDefaultOAuthServerConfig } from '../constants/oauthServerDefaults.js';
import { isCredentialWriteScope } from './credentialWriteScope.js';
import { getPublicResourceUrl, getResourceMetadataUrl } from './protectedResource.js';

/**
 * Scopes a client should request for MCPHub's MCP/SSE routes. MCPHub does not require any
 * particular scope on those routes today: a valid access token opens them whatever it carries.
 * So the scopes to request are the ones the authorization server offers, minus the ones that
 * are not about this resource: `offline_access` (a refresh-token hint, never a resource scope)
 * and `credentials:write:<server>` (opens the credential endpoints only, not MCP routes).
 *
 * Empty when the OAuth server is disabled: there is no authorization server to request from.
 */
export const getResourceScopes = (systemConfig?: SystemConfig | null): string[] => {
  const oauthConfig = { ...cloneDefaultOAuthServerConfig(), ...systemConfig?.oauthServer };
  if (!oauthConfig.enabled) return [];
  const scopes = (oauthConfig.allowedScopes || [])
    .filter((scope): scope is string => typeof scope === 'string')
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0 && !/\s/.test(scope))
    .filter((scope) => scope !== 'offline_access' && !isCredentialWriteScope(scope));
  return [...new Set(scopes)];
};

/** Escape a value for an HTTP quoted-string; control characters are dropped, not escaped. */
export const escapeHeaderValue = (value: string): string =>
  value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');

export interface BearerChallengeParams {
  /** Omitted when the request carried no credentials (RFC 6750 section 3.1). */
  error?: 'invalid_request' | 'invalid_token' | 'insufficient_scope';
  errorDescription?: string;
  resourceMetadata?: string;
  scopes?: string[];
}

/** Build a `WWW-Authenticate: Bearer ...` value (RFC 6750 section 3, RFC 9728 section 5.1). */
export const buildBearerChallenge = ({
  error,
  errorDescription,
  resourceMetadata,
  scopes,
}: BearerChallengeParams): string => {
  const parts: string[] = [];
  if (error) parts.push(`error="${error}"`);
  if (error && errorDescription) {
    parts.push(`error_description="${escapeHeaderValue(errorDescription)}"`);
  }
  if (resourceMetadata) parts.push(`resource_metadata="${escapeHeaderValue(resourceMetadata)}"`);
  if (scopes && scopes.length > 0) parts.push(`scope="${escapeHeaderValue(scopes.join(' '))}"`);
  return parts.length > 0 ? `Bearer ${parts.join(', ')}` : 'Bearer';
};

/** The resource-server challenge context for a request: its metadata URL and scopes. */
export const getChallengeContext = (
  req: Request,
  systemConfig?: SystemConfig | null,
): { resourceMetadata: string; scopes: string[] } => ({
  resourceMetadata: getResourceMetadataUrl(getPublicResourceUrl(req, systemConfig)),
  scopes: getResourceScopes(systemConfig),
});
