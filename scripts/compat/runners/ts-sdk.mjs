// Official TypeScript SDK client (@modelcontextprotocol/client) with its OAuth provider contract.
// MCP Inspector, Claude Code and the Vercel AI SDK MCP client all sit on this OAuth machinery.
//
// Variants (COMPAT_VARIANT): dcr-legacy | dcr-auto | cimd-legacy
//   dcr/cimd:   how the client identifies itself (Dynamic Client Registration vs Client ID Metadata Document)
//   legacy/auto: versionNegotiation off (2025-11-25 initialize) vs 'auto' (probe server/discover, 2026-07-28)
import { Client, StreamableHTTPClientTransport, UnauthorizedError } from '@modelcontextprotocol/client';
import { createRecorder, emitResult } from '../lib/steps.mjs';
import { pkgVersion } from '../lib/versions.mjs';

const ctx = JSON.parse(process.env.COMPAT_CTX);
const variant = process.env.COMPAT_VARIANT || 'dcr-legacy';
const [registrationKind, negotiation] = variant.split('-');
const forced = registrationKind === 'cimdforced';
const registration = forced ? 'cimd' : registrationKind;
const sdkVersion = pkgVersion('@modelcontextprotocol/client');

const rec = createRecorder({
  name: 'ts-sdk',
  variant,
  versions: { '@modelcontextprotocol/client': sdkVersion, node: process.version },
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

class MemoryProvider {
  constructor() {
    this._tokens = undefined;
    // `cimdforced`: the client_id URL is supplied as pre-registered information, bypassing the
    // SDK's own gate on the AS advertising client_id_metadata_document_supported.
    this._client = forced ? { client_id: ctx.cimd.clientId } : undefined;
    this._verifier = undefined;
    this.authorizationUrl = undefined;
    this.savedTokenCount = 0;
  }
  get redirectUrl() {
    return registration === 'cimd' ? ctx.cimd.redirectUri : 'http://127.0.0.1:9/callback';
  }
  get clientMetadataUrl() {
    return registration === 'cimd' && !forced ? ctx.cimd.clientId : undefined;
  }
  get clientMetadata() {
    return {
      client_name: 'compat-ts-sdk',
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
  invalidateCredentials(scope) {
    if (scope === 'all' || scope === 'tokens') this._tokens = undefined;
    if (scope === 'all' || scope === 'client') this._client = undefined;
  }
}

const provider = new MemoryProvider();
const clientOptions = negotiation === 'auto' ? { versionNegotiation: { mode: 'auto' } } : {};
const newClient = () => new Client({ name: 'compat-ts-sdk', version: '1.0.0' }, clientOptions);
const newTransport = () =>
  new StreamableHTTPClientTransport(new URL(ctx.mcpUrl), { authProvider: provider });

let client = newClient();
let transport = newTransport();
let observed;

await rec.step('discovery', async () => {
  try {
    await client.connect(transport);
  } catch (error) {
    if (!(error instanceof UnauthorizedError)) throw error;
  }
  if (!provider.authorizationUrl) throw new Error('client never reached the authorization redirect');
  return `reached authorization endpoint ${provider.authorizationUrl.origin}${provider.authorizationUrl.pathname}`;
});

await rec.step('register', async () => {
  const info = provider.clientInformation();
  if (!info?.client_id) throw new Error('no client_id obtained');
  const url = provider.authorizationUrl;
  if (registration === 'cimd') {
    if (info.client_id !== ctx.cimd.clientId) {
      throw new Error(`client did not use the CIMD URL as client_id (got ${info.client_id})`);
    }
    return `CIMD client_id=${info.client_id}${forced ? ' (supplied as pre-registered information)' : ''}`;
  }
  return `DCR client_id=${info.client_id} (authorization URL client_id=${url.searchParams.get('client_id')})`;
});

await rec.step('login', async () => {
  const url = provider.authorizationUrl;
  const result = await browser(url);
  observed = result.observed;
  const callback = new URL(result.redirect);
  if (callback.searchParams.get('error')) {
    throw new Error(
      `authorization refused: ${callback.searchParams.get('error')} ${callback.searchParams.get('error_description') ?? ''}`,
    );
  }
  await transport.finishAuth(callback.searchParams);
  if (!provider.tokens()?.access_token) throw new Error('no access token after code exchange');
  return `PKCE=${observed.pkceMethod} resource=${observed.resource ?? 'none'} iss-in-callback=${observed.callbackHasIss} refresh_token=${Boolean(provider.tokens().refresh_token)}`;
});

await rec.step('list', async () => {
  client = newClient();
  transport = newTransport();
  await client.connect(transport);
  const negotiated = client.getNegotiatedProtocolVersion?.();
  if (negotiated) rec.result.protocol = { negotiated, era: client.getProtocolEra?.() ?? null };
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  if (!names.some((n) => n.endsWith('echo'))) throw new Error(`echo tool missing: ${names.join(',')}`);
  return `${names.length} tool(s): ${names.join(', ')}`;
});

const callEcho = async (message) => {
  const { tools } = await client.listTools();
  const tool = tools.find((t) => t.name.endsWith('echo'));
  const result = await client.callTool({ name: tool.name, arguments: { message } });
  const text = result.content?.find((c) => c.type === 'text')?.text;
  if (!String(text).includes(message)) throw new Error(`unexpected tool result: ${JSON.stringify(result).slice(0, 200)}`);
  return text;
};

await rec.step('call', async () => `result: ${await callEcho('hello-1')}`);

await rec.step('refresh', async () => {
  const before = provider.tokens().access_token;
  const savedBefore = provider.savedTokenCount;
  await new Promise((r) => setTimeout(r, (ctx.accessTokenLifetime + 2) * 1000));
  const text = await callEcho('hello-2-after-expiry');
  const after = provider.tokens().access_token;
  if (after === before) throw new Error('call succeeded but the access token was never replaced');
  return `access token replaced (saveTokens x${provider.savedTokenCount - savedBefore}); result: ${text}`;
});

await client.close().catch(() => undefined);
emitResult(rec.result);
process.exit(0);
