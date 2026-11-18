// Vercel AI SDK MCP client (@ai-sdk/mcp, used through the `ai` package) with its OAuthClientProvider.
//
// Variants (COMPAT_VARIANT): dcr | cimdforced
//   The provider interface has no clientMetadataUrl, so the SDK never selects CIMD by itself. The
//   `cimdforced` variant hands the client_id URL in as pre-registered client information, which is
//   how an application would use a CIMD identity with this SDK.
import { createMCPClient, auth, UnauthorizedError } from '@ai-sdk/mcp';
import { createRecorder, emitResult } from '../lib/steps.mjs';
import { pkgVersion } from '../lib/versions.mjs';
import crypto from 'node:crypto';

const ctx = JSON.parse(process.env.COMPAT_CTX);
const variant = process.env.COMPAT_VARIANT || 'dcr';
const here = new URL('..', import.meta.url).pathname;

const rec = createRecorder({
  name: 'ai-sdk',
  variant,
  versions: {
    '@ai-sdk/mcp': pkgVersion('@ai-sdk/mcp', here),
    ai: pkgVersion('ai', here),
    node: process.version,
  },
});

const browser = async (authorizationUrl) => {
  const res = await fetch(ctx.browserUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-compat-secret': ctx.browserSecret },
    body: JSON.stringify({ authorizationUrl: String(authorizationUrl) }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? `browser agent ${res.status}`);
  return body;
};

class Provider {
  constructor() {
    this._tokens = undefined;
    this._client = variant === 'cimdforced' ? { client_id: ctx.cimd.clientId } : undefined;
    this._verifier = undefined;
    this._state = undefined;
    this._as = undefined;
    this._dynamic = false;
    this.authorizationUrl = undefined;
    this.savedTokenCount = 0;
  }
  get redirectUrl() {
    return variant === 'cimdforced' ? ctx.cimd.redirectUri : 'http://127.0.0.1:9/callback';
  }
  get clientMetadata() {
    return {
      client_name: 'compat-ai-sdk',
      redirect_uris: [String(this.redirectUrl)],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    };
  }
  clientInformation() {
    return this._client;
  }
  saveClientInformation(info) {
    this._client = info;
    this._dynamic = true;
  }
  isClientInformationDynamicallyRegistered() {
    return this._dynamic;
  }
  authorizationServerInformation() {
    return this._as;
  }
  saveAuthorizationServerInformation(info) {
    this._as = info;
  }
  tokens() {
    return this._tokens;
  }
  saveTokens(tokens) {
    this._tokens = tokens;
    this.savedTokenCount += 1;
  }
  redirectToAuthorization(url) {
    this.authorizationUrl = url;
  }
  saveCodeVerifier(v) {
    this._verifier = v;
  }
  codeVerifier() {
    return this._verifier;
  }
  state() {
    return crypto.randomBytes(16).toString('hex');
  }
  saveState(s) {
    this._state = s;
  }
  storedState() {
    return this._state;
  }
  invalidateCredentials(scope) {
    if (scope === 'all' || scope === 'tokens') this._tokens = undefined;
    if (scope === 'all' || scope === 'client') this._client = undefined;
  }
}

const provider = new Provider();
const connect = () =>
  createMCPClient({ transport: { type: 'http', url: ctx.mcpUrl, authProvider: provider } });

let client;
await rec.step('discovery', async () => {
  try {
    client = await connect();
  } catch (error) {
    if (!(error instanceof UnauthorizedError) && error?.name !== 'UnauthorizedError') throw error;
  }
  if (!provider.authorizationUrl) throw new Error('client never reached the authorization redirect');
  return `reached authorization endpoint ${provider.authorizationUrl.origin}${provider.authorizationUrl.pathname}`;
});

await rec.step('register', async () => {
  const info = provider.clientInformation();
  if (!info?.client_id) throw new Error('no client_id obtained');
  if (variant === 'cimdforced') return `CIMD client_id=${info.client_id} (supplied as pre-registered information)`;
  return `DCR client_id=${info.client_id}`;
});

await rec.step('login', async () => {
  const result = await browser(provider.authorizationUrl);
  const callback = new URL(result.redirect);
  if (callback.searchParams.get('error')) {
    throw new Error(`authorization refused: ${callback.searchParams.get('error')} ${callback.searchParams.get('error_description') ?? ''}`);
  }
  const outcome = await auth(provider, {
    serverUrl: ctx.mcpUrl,
    authorizationCode: callback.searchParams.get('code'),
    callbackState: callback.searchParams.get('state') ?? undefined,
    callbackIssuer: callback.searchParams.get('iss') ?? undefined,
  });
  if (outcome !== 'AUTHORIZED' || !provider.tokens()?.access_token) throw new Error(`auth() returned ${outcome}`);
  const o = result.observed;
  return `PKCE=${o.pkceMethod} resource=${o.resource ?? 'none'} iss-in-callback=${o.callbackHasIss} refresh_token=${Boolean(provider.tokens().refresh_token)}`;
});

await rec.step('list', async () => {
  client = await connect();
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  if (!names.some((n) => n.endsWith('echo'))) throw new Error(`echo tool missing: ${names.join(',')}`);
  if (client.initializeResult?.protocolVersion) {
    rec.result.protocol = { negotiated: client.initializeResult.protocolVersion, era: null };
  }
  return `${names.length} tool(s): ${names.join(', ')}`;
});

// The path an AI SDK application takes: client.tools() yields AI SDK tools (what generateText /
// streamText are given); the model's tool call ends up in tool.execute().
const callEcho = async (message) => {
  const tools = await client.tools();
  const name = Object.keys(tools).find((n) => n.endsWith('echo'));
  if (!name) throw new Error(`echo tool missing: ${Object.keys(tools).join(',')}`);
  const result = await tools[name].execute({ message }, { toolCallId: 'compat-call', messages: [] });
  const text = result?.content?.find?.((c) => c.type === 'text')?.text ?? JSON.stringify(result);
  if (!String(text).includes(message)) throw new Error(`unexpected tool result: ${JSON.stringify(result).slice(0, 200)}`);
  return text;
};

await rec.step('call', async () => `result: ${await callEcho('hello-1')}`);

await rec.step('refresh', async () => {
  const before = provider.tokens().access_token;
  await new Promise((r) => setTimeout(r, (ctx.accessTokenLifetime + 2) * 1000));
  const text = await callEcho('hello-2-after-expiry');
  const after = provider.tokens().access_token;
  if (after === before) throw new Error('call succeeded but the access token was never replaced');
  return `access token replaced; result: ${text}`;
});

await client?.close().catch(() => undefined);
emitResult(rec.result);
process.exit(0);
