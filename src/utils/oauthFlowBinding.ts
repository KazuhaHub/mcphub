import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';

/**
 * Binds a personal OAuth flow to the browser that started it (the standard OAuth-client defence
 * against login CSRF). Without it, `state` alone finds the flow: user A starts Connect and sends
 * the authorization URL to V, V consents upstream, and the callback stores V's grant in A's binding.
 *
 * At flow start the signed-in user's browser receives a random nonce in a short-lived HttpOnly,
 * SameSite=Lax cookie scoped to the callback path; only its hash is stored with the pending flow.
 * The callback must present the same nonce.
 */
export const FLOW_COOKIE = 'mcphub_oauth_flow';
export const FLOW_COOKIE_MAX_AGE_MS = 10 * 60 * 1000;

export const newFlowNonce = (): string => randomBytes(32).toString('base64url');

export const hashFlowNonce = (nonce: string): string =>
  createHash('sha256').update(nonce).digest('hex');

export const flowNonceMatches = (stored: string | undefined, nonce: string | undefined): boolean => {
  if (!stored || !nonce) return false;
  const expected = Buffer.from(stored, 'hex');
  const actual = Buffer.from(hashFlowNonce(nonce), 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
};

export const readFlowNonce = (req: Request): string | undefined => {
  const header = req.headers?.cookie;
  if (typeof header !== 'string') return undefined;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === FLOW_COOKIE) {
      return part.slice(index + 1).trim() || undefined;
    }
  }
  return undefined;
};

/** The callback's path and scheme, from the `redirect_uri` of the authorization URL. */
const callbackOf = (authorizationUrl: string | undefined): { path: string; secure: boolean } => {
  try {
    const redirect = new URL(authorizationUrl ?? '').searchParams.get('redirect_uri');
    if (redirect) {
      const url = new URL(redirect);
      return { path: url.pathname || '/', secure: url.protocol === 'https:' };
    }
  } catch {
    // Fall through to the broadest scope.
  }
  return { path: '/', secure: false };
};

export const setFlowCookie = (
  res: Response,
  nonce: string,
  authorizationUrl: string | undefined,
): void => {
  const { path, secure } = callbackOf(authorizationUrl);
  res.cookie(FLOW_COOKIE, nonce, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path,
    maxAge: FLOW_COOKIE_MAX_AGE_MS,
  });
};

export const clearFlowCookie = (req: Request, res: Response): void => {
  let path = '/';
  try {
    path = new URL(req.originalUrl || req.url, 'http://localhost').pathname;
  } catch {
    // Keep the default.
  }
  res.clearCookie(FLOW_COOKIE, { path });
};
