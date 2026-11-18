/**
 * redirect_uri matching for OAuth clients.
 *
 * Registered redirect URIs are compared exactly, except for loopback redirects of
 * native-style clients (RFC 8252 section 7.3, relied on by the Client ID Metadata
 * Document draft and the MCP authorization spec): native apps bind an ephemeral
 * port at runtime, so for a registered `http` URI whose host is `127.0.0.1`,
 * `[::1]` or `localhost` the port is ignored while scheme, host, path and query
 * must still match exactly. Nothing is relaxed for any other host.
 */

const LOOPBACK_HTTP = /^http:\/\/(127\.0\.0\.1|\[::1\]|localhost)(?::(\d{1,5}))?((?:[/?])[^#]*)?$/;

const parseLoopback = (uri: string): { host: string; rest: string } | undefined => {
  const match = LOOPBACK_HTTP.exec(uri);
  if (!match) return undefined;
  if (match[2] !== undefined) {
    const port = Number(match[2]);
    if (port < 1 || port > 65535) return undefined;
  }
  return { host: match[1], rest: match[3] ?? '' };
};

export const redirectUriMatches = (
  registered: readonly string[],
  requested: string,
  allowLoopbackPort: boolean,
): boolean => {
  if (registered.includes(requested)) return true;
  if (!allowLoopbackPort) return false;
  const runtime = parseLoopback(requested);
  if (!runtime) return false;
  return registered.some((candidate) => {
    const reg = parseLoopback(candidate);
    return reg !== undefined && reg.host === runtime.host && reg.rest === runtime.rest;
  });
};

/**
 * Whether a client may use loopback port flexibility: CIMD clients (HTTPS URL
 * identifiers) and clients that declared application_type "native".
 */
export const allowsLoopbackPortFlexibility = (client: {
  clientId: string;
  metadata?: { application_type?: string } | undefined;
}): boolean =>
  client.clientId.startsWith('https://') || client.metadata?.application_type === 'native';
