// The "browser" step of the OAuth flow, done programmatically.
//
// A real user opens the authorization URL, signs in to the dashboard and presses "Allow". The
// SPA consent page (frontend/src/pages/OAuthConsentPage.tsx) does exactly two things with the
// dashboard session token it holds: GET the authorization URL with `x-auth-token` and
// `Accept: application/json`, then POST the consent form to /oauth/authorize with the same
// header and read `{ redirect }` from the JSON answer. This agent performs those two calls as
// the test user, through MCPHub's real endpoints, and hands back the redirect URL the browser
// would have been sent to. Nothing about server-side authentication is relaxed.
//
// Clients that run in another process (Python, the Inspector CLI) reach it over a loopback HTTP
// endpoint: POST /authorize { authorizationUrl } -> { redirect, observed }.
import crypto from 'node:crypto';
import http from 'node:http';

const FORWARDED = [
  'client_id',
  'redirect_uri',
  'response_type',
  'scope',
  'resource',
  'state',
  'code_challenge',
  'code_challenge_method',
];

export const createBrowserAgent = ({ hubUrl, login }) => {
  let sessionToken;
  const consents = [];

  const authorize = async (authorizationUrl) => {
    const url = new URL(authorizationUrl);
    // The dashboard session token only ever goes to the hub under test.
    if (url.origin !== new URL(hubUrl).origin) {
      throw new Error(`refusing to present the test session to ${url.origin}; the hub under test is ${new URL(hubUrl).origin}`);
    }
    sessionToken ??= await login();
    const params = Object.fromEntries(url.searchParams);
    const observed = {
      clientId: params.client_id,
      pkceMethod: params.code_challenge_method ?? null,
      hasCodeChallenge: Boolean(params.code_challenge),
      resource: params.resource ?? null,
      scope: params.scope ?? null,
      hasState: Boolean(params.state),
    };
    const consent = { observed };
    consents.push(consent);

    // 1. What the SPA does on load: let the server validate the request for this user.
    const check = await fetch(url, {
      headers: { accept: 'application/json', 'x-auth-token': sessionToken },
      redirect: 'manual',
    });
    consent.authorizeGetStatus = check.status;
    if (check.status >= 300 && check.status < 400) {
      // MCPHub refused the request and redirects the error to the client (e.g. invalid_target).
      return { redirect: check.headers.get('location'), observed, refusedAtGet: true };
    }
    if (!check.ok) {
      throw new Error(`GET /oauth/authorize answered ${check.status}: ${(await check.text()).slice(0, 300)}`);
    }

    // 2. What the SPA does on "Allow access".
    const body = new URLSearchParams();
    for (const key of FORWARDED) if (params[key] !== undefined) body.set(key, params[key]);
    body.set('allow', 'true');
    const post = await fetch(`${new URL(url).origin}/oauth/authorize`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
        'x-auth-token': sessionToken,
      },
      body,
      redirect: 'manual',
    });
    consent.authorizePostStatus = post.status;
    const result = await post.json().catch(() => undefined);
    if (!result?.redirect) {
      throw new Error(`POST /oauth/authorize answered ${post.status} without a redirect: ${JSON.stringify(result)}`);
    }
    const redirect = new URL(result.redirect);
    observed.callbackHasCode = redirect.searchParams.has('code');
    observed.callbackHasIss = redirect.searchParams.has('iss');
    observed.callbackStateEchoed = params.state ? redirect.searchParams.get('state') === params.state : null;
    return { redirect: result.redirect, observed };
  };

  const secret = crypto.randomBytes(16).toString('hex');
  let server;
  return {
    authorize,
    consents,
    secret,
    start: async () => {
      server = http.createServer(async (req, res) => {
        if (req.method !== 'POST' || req.url !== '/authorize' || req.headers['x-compat-secret'] !== secret) {
          res.writeHead(404).end();
          return;
        }
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        try {
          const { authorizationUrl } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          const result = await authorize(authorizationUrl);
          res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result));
        } catch (error) {
          res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: String(error) }));
        }
      });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      return `http://127.0.0.1:${server.address().port}/authorize`;
    },
    stop: () => new Promise((resolve) => (server ? server.close(() => resolve()) : resolve())),
  };
};
