// MCP Inspector in CLI mode (@modelcontextprotocol/inspector --cli).
//
// The CLI does interactive OAuth: it starts a loopback callback listener, prints "Please navigate
// to: <authorization URL>" on stderr and waits. This runner is the "browser": it reads that URL
// from stderr, has the harness complete the consent as the test user, and requests the callback URL
// the way the browser's redirect would. The CLI only starts a non-TTY login with MCP_AUTO_OPEN_ENABLED=true,
// so runners/no-browser.mjs swallows the browser launch it then attempts, and HOME points at a throwaway directory so nothing touches the user's real Inspector state.
//
// One CLI invocation is one MCP method, so the steps are separate invocations sharing the CLI's
// stored OAuth state: tools/list (discovery, registration, login), tools/call, then tools/call
// again after the access token has expired (refresh).
//
// Variants (COMPAT_VARIANT): dcr | cimd | cimdforced
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRecorder, emitResult } from '../lib/steps.mjs';
import { pkgVersion } from '../lib/versions.mjs';

const ctx = JSON.parse(process.env.COMPAT_CTX);
const variant = process.env.COMPAT_VARIANT || 'dcr';
const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const launcher = path.join(here, 'node_modules', '@modelcontextprotocol', 'inspector', 'clients', 'launcher', 'build', 'index.js');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'compat-inspector-home-'));

const rec = createRecorder({
  name: 'inspector-cli',
  variant,
  versions: { '@modelcontextprotocol/inspector': pkgVersion('@modelcontextprotocol/inspector', here), node: process.version },
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

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const ANSI = new RegExp(`${ESC}\\[[0-9;]*m|${ESC}\\]8;;[^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)`, 'g');
const stripAnsi = (s) => s.replace(ANSI, '');

const invoke = async (extraArgs) => {
  // Fixed per run: a CIMD document lists its redirect URIs, so the harness put this one in it.
  const callbackPort = ctx.cimd.inspectorCallbackPort;
  const args = [
    launcher,
    '--cli',
    '--server-url',
    ctx.mcpUrl,
    '--transport',
    'http',
    '--callback-url',
    `http://127.0.0.1:${callbackPort}/oauth/callback`,
    '--oauth-debug',
    ...(variant === 'cimd' ? ['--client-metadata-url', ctx.cimd.clientId] : []),
    ...(variant === 'cimdforced' ? ['--client-id', ctx.cimd.clientId] : []),
    ...extraArgs,
  ];
  const child = spawn(process.execPath, args, {
    env: {
      ...process.env,
      HOME: home,
      // Required for a non-TTY interactive login; the preload turns the browser launch into a no-op.
      MCP_AUTO_OPEN_ENABLED: 'true',
      NODE_OPTIONS: `--import=${pathToFileURL(path.join(here, 'runners', 'no-browser.mjs')).href}`,
      NO_COLOR: '1',
      MCP_CATALOG_PATH: path.join(home, 'mcp.json'),
      XDG_CONFIG_HOME: path.join(home, '.config'),
      XDG_DATA_HOME: path.join(home, '.local', 'share'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  let authorizationUrl;
  let observed;
  let callbackError;
  let handled = false;
  const onData = (chunk) => {
    stderr += chunk;
    if (handled) return;
    const m = stripAnsi(stderr).match(/Please navigate to:\s*(https?:\/\/\S+)/);
    if (!m) return;
    handled = true;
    authorizationUrl = m[1];
    (async () => {
      try {
        const result = await browser(authorizationUrl);
        observed = result.observed;
        // What the browser does after consent: follow the redirect to the CLI's loopback listener.
        const res = await fetch(result.redirect, { redirect: 'manual' });
        await res.text();
      } catch (error) {
        callbackError = String(error);
      }
    })();
  };
  child.stdout.on('data', (d) => (stdout += d));
  child.stderr.on('data', onData);
  const timer = setTimeout(() => child.kill('SIGKILL'), 90_000);
  const code = await new Promise((resolve) => child.on('exit', (c) => resolve(c)));
  clearTimeout(timer);
  return { code, stdout, stderr: stripAnsi(stderr), authorizationUrl, observed, callbackError };
};

const parseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

const tail = (s, n = 500) => s.trim().split('\n').slice(-6).join(' | ').slice(-n);

let first;
let echoTool;
await rec.step('discovery', async () => {
  first = await invoke(['--method', 'tools/list']);
  if (!first.authorizationUrl) {
    throw new Error(`CLI never printed an authorization URL (exit ${first.code}): ${tail(first.stderr)}`);
  }
  const u = new URL(first.authorizationUrl);
  return `reached authorization endpoint ${u.origin}${u.pathname}`;
});

await rec.step('register', async () => {
  const clientId = new URL(first.authorizationUrl).searchParams.get('client_id');
  if (variant.startsWith('cimd')) {
    if (clientId !== ctx.cimd.clientId) {
      throw new Error(`client did not use the CIMD URL as client_id (got ${clientId}); it falls back to DCR unless the server advertises client_id_metadata_document_supported`);
    }
    return `CIMD client_id=${clientId}${variant === 'cimdforced' ? ' (supplied with --client-id)' : ''}`;
  }
  return `DCR client_id=${clientId}`;
});

await rec.step('login', async () => {
  if (first.callbackError) throw new Error(first.callbackError);
  if (first.code !== 0) throw new Error(`CLI exited ${first.code} after consent: ${tail(first.stderr)}`);
  const o = first.observed ?? {};
  return `PKCE=${o.pkceMethod} resource=${o.resource ?? 'none'} iss-in-callback=${o.callbackHasIss}`;
});

await rec.step('list', async () => {
  const body = parseJson(first.stdout);
  const names = (body?.tools ?? []).map((t) => t.name);
  echoTool = names.find((n) => n.endsWith('echo'));
  if (!echoTool) throw new Error(`echo tool missing: ${first.stdout.slice(0, 300)}`);
  return `${names.length} tool(s): ${names.join(', ')}`;
});

const callEcho = async (message) => {
  const run = await invoke(['--method', 'tools/call', '--tool-name', echoTool, '--tool-arg', `message=${message}`]);
  if (run.authorizationUrl) throw new Error('CLI asked for a new interactive login instead of reusing/refreshing stored OAuth state');
  const body = parseJson(run.stdout);
  const text = body?.content?.find((c) => c.type === 'text')?.text;
  if (run.code !== 0 || !String(text).includes(message)) {
    throw new Error(`tools/call failed (exit ${run.code}): ${tail(run.stderr || run.stdout)}`);
  }
  return text;
};

await rec.step('call', async () => `result (new invocation, stored token): ${await callEcho('hello-1')}`);

await rec.step('refresh', async () => {
  await new Promise((r) => setTimeout(r, (ctx.accessTokenLifetime + 2) * 1000));
  return `result: ${await callEcho('hello-2-after-expiry')}`;
});

// The CLI does not print the negotiated version; the harness reads it from the wire.
fs.rmSync(home, { recursive: true, force: true });
emitResult(rec.result);
process.exit(0);
