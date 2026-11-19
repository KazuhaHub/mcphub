// Starts a throwaway MCPHub (real application code, `tsx src/index.ts`) on a free port with a
// temp settings directory, fronted by a recording proxy.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import crypto from 'node:crypto';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { startRecordingProxy } from './proxy.mjs';

// Only what the child processes need from the caller's environment. Anything else (INSTALL_BASE_URL,
// BASE_PATH, OIDC/GitHub/Google client settings, replica flags, ...) would redirect the throwaway
// hub or its clients at a real deployment.
const ENV_ALLOW = ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'USER', 'SHELL', 'SystemRoot', 'COMSPEC'];
export const cleanEnv = (extra = {}) => {
  const env = {};
  for (const key of ENV_ALLOW) if (process.env[key] !== undefined) env[key] = process.env[key];
  return { ...env, ...extra };
};

const freePort = () =>
  new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const buildSettings = ({ upstreamUrl, accessTokenLifetime, cimd, user }) => ({
  mcpServers: {
    everything: { type: 'streamable-http', url: upstreamUrl, enabled: true },
  },
  users: [
    {
      username: user.username,
      password: bcrypt.hashSync(user.password, 10),
      isAdmin: true,
    },
  ],
  systemConfig: {
    // The upstream is on loopback; MCPHub's SSRF guard blocks that unless it is allow-listed.
    network: { allowedCidrs: ['127.0.0.1/32'] },
    routing: { enableGlobalRoute: true, enableBearerAuth: true },
    // The full block, not a partial one: see the README ("dynamicRegistration on partial config").
    oauthServer: {
      enabled: true,
      alwaysShowApprovalScreen: true,
      accessTokenLifetime,
      refreshTokenLifetime: 1209600,
      authorizationCodeLifetime: 300,
      requireClientSecret: false,
      allowedScopes: ['read', 'write'],
      requireState: false,
      dynamicRegistration: {
        enabled: true,
        allowedGrantTypes: ['authorization_code', 'refresh_token'],
        requiresAuthentication: false,
      },
      // `enabled` is left out on purpose: the run then reports the shipped default, not a harness override.
      clientIdMetadata: { cacheTtlMs: 3_600_000 },
    },
  },
});

export const startHub = async ({ repoRoot, hubRoot = repoRoot, workDir, upstreamUrl, accessTokenLifetime, cimd }) => {
  fs.mkdirSync(path.join(workDir, 'home'), { recursive: true });
  // Fresh credentials per run: the hub is reachable by any local user for the length of a run.
  const user = { username: 'compat', password: crypto.randomBytes(18).toString('base64url') };
  const settingsPath = path.join(workDir, 'mcp_settings.json');
  fs.writeFileSync(
    settingsPath,
    JSON.stringify(buildSettings({ upstreamUrl, accessTokenLifetime, cimd, user }), null, 2),
  );

  const port = await freePort();
  const logPath = path.join(workDir, 'hub.log');
  const logFd = fs.openSync(logPath, 'w');
  const tsx = path.join(hubRoot, 'node_modules', '.bin', 'tsx');
  const args = [];
  if (cimd) args.push('--import', path.join(repoRoot, 'scripts', 'compat', 'lib', 'hub-preload.mjs'));
  args.push(path.join(hubRoot, 'src', 'index.ts'));

  const child = spawn(tsx, args, {
    cwd: hubRoot, // tsx resolves tsconfig.json (decorator settings) from the working directory
    detached: true,
    env: cleanEnv({
      HOME: path.join(workDir, 'home'),
      COMPAT_HUB_ROOT: hubRoot,
      PORT: String(port),
      MCPHUB_HOST: '127.0.0.1',
      MCPHUB_SETTING_PATH: settingsPath,
      JWT_SECRET: crypto.randomBytes(32).toString('hex'),
      USE_DB: 'false',
      DB_URL: '',
      DISABLE_WEB: 'true',
      NODE_ENV: 'production',
      ...(cimd
        ? { COMPAT_CIMD_CLIENT_ID: cimd.clientId, COMPAT_CIMD_DOCUMENT: JSON.stringify(cimd.document) }
        : {}),
    }),
    stdio: ['ignore', logFd, logFd],
  });
  let exited = false;
  child.once('exit', () => {
    exited = true;
  });

  const killChild = async () => {
    if (!exited) {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        child.kill('SIGTERM');
      }
      await Promise.race([new Promise((resolve) => child.once('exit', resolve)), sleep(5000)]);
      if (!exited) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          child.kill('SIGKILL');
        }
      }
    }
  };

  const internalUrl = `http://127.0.0.1:${port}`;
  try {
    const deadline = Date.now() + 90_000;
    for (;;) {
      if (exited) throw new Error(`MCPHub exited during startup, see ${logPath}`);
      if (Date.now() > deadline) throw new Error(`MCPHub did not become healthy, see ${logPath}`);
      try {
        const res = await fetch(`${internalUrl}/health`);
        if (res.ok) break;
      } catch {
        // not listening yet
      }
      await sleep(250);
    }
    // The upstream connection is established asynchronously after the port opens: wait until the
    // hub reports it connected, or fail loudly rather than let clients fail at `list`.
    const token = await loginWith(internalUrl, user);
    const readyDeadline = Date.now() + 30_000;
    for (;;) {
      const res = await fetch(`${internalUrl}/api/servers`, { headers: { 'x-auth-token': token } }).catch(() => undefined);
      const body = res ? await res.json().catch(() => undefined) : undefined;
      const servers = Array.isArray(body?.data) ? body.data : [];
      if (servers.some((srv) => srv.name === 'everything' && srv.status === 'connected')) break;
      if (Date.now() > readyDeadline) throw new Error(`upstream "everything" did not connect, see ${logPath}`);
      await sleep(250);
    }
  } catch (error) {
    await killChild();
    fs.closeSync(logFd);
    throw error;
  }

  const proxy = await startRecordingProxy(port);
  return {
    url: proxy.url,
    internalUrl,
    logPath,
    proxy,
    login: () => loginWith(proxy.url, user),
    stop: async () => {
      await proxy.close();
      await killChild();
      fs.closeSync(logFd);
    },
  };
};

const loginWith = async (baseUrl, user) => {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(user),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.token) throw new Error(`dashboard login failed: HTTP ${res.status}`);
  return body.token;
};
