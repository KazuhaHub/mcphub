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
const FLOW_COOKIE = 'mcphub_oauth_flow';
export const FLOW_COOKIE_MAX_AGE_MS = 10 * 60 * 1000;

export const newFlowNonce = (): string => randomBytes(32).toString('base64url');

export const hashFlowNonce = (nonce: string): string =>
  createHash('sha256').update(nonce).digest('hex');

export const flowNonceMatches = (
  stored: string | undefined,
  nonce: string | undefined,
): boolean => {
  if (!stored || !nonce) return false;
  const expected = Buffer.from(stored, 'hex');
  const actual = Buffer.from(hashFlowNonce(nonce), 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
};

/**
 * One cookie per flow, so two Connects in the same browser don't overwrite each other. On https it
 * carries the `__Host-` prefix: the browser then accepts it only from this exact host, Secure, with
 * Path=/ and no Domain, so a sibling subdomain cannot plant its own value.
 */
export const flowCookieName = (state: string, secure: boolean): string =>
  `${secure ? '__Host-' : ''}${FLOW_COOKIE}_${createHash('sha256').update(state).digest('hex').slice(0, 16)}`;

/** Whether the flow's callback (the `redirect_uri` of its authorization URL) is https. */
export const flowIsSecure = (authorizationUrl: string | undefined): boolean => {
  try {
    const redirect = new URL(authorizationUrl ?? '').searchParams.get('redirect_uri');
    return redirect ? new URL(redirect).protocol === 'https:' : false;
  } catch {
    return false;
  }
};

const cookieValue = (req: Request, name: string): string | undefined => {
  const header = req.headers?.cookie;
  if (typeof header !== 'string') return undefined;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === name) {
      return part.slice(index + 1).trim() || undefined;
    }
  }
  return undefined;
};

/** Reads exactly the cookie the flow set: the `__Host-` one for an https callback, never both. */
export const flowNonceReader =
  (req: Request) =>
  (state: string, secure: boolean): string | undefined =>
    cookieValue(req, flowCookieName(state, secure));

export const setFlowCookie = (
  res: Response,
  nonce: string,
  state: string,
  authorizationUrl: string | undefined,
): void => {
  const secure = flowIsSecure(authorizationUrl);
  res.cookie(flowCookieName(state, secure), nonce, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: FLOW_COOKIE_MAX_AGE_MS,
  });
};

/** Drops the flow's cookie, whichever variant it was; used after every callback attempt. */
export const clearFlowCookie = (res: Response, state: string): void => {
  res.clearCookie(flowCookieName(state, true), {
    path: '/',
    secure: true,
    httpOnly: true,
    sameSite: 'lax',
  });
  res.clearCookie(flowCookieName(state, false), { path: '/', httpOnly: true, sameSite: 'lax' });
};
