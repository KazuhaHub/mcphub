import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { startUpstream } from './upstream.mjs';
import { cleanEnv, startHub } from './hub.mjs';
import { createBrowserAgent } from './browser.mjs';
import { runDiscoveryProbe } from './probe.mjs';
import { buildRunners } from './runners.mjs';
import { classify, GAP_BRANCHES } from './known-gaps.mjs';
import { STEPS } from './steps.mjs';
import { formatReport } from '../report.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const USAGE = `usage: node scripts/compat/run.mjs [options]

  --out <file>        write the JSON results here
  --python <path>       python from a venv with runners/requirements.txt (mcp 1.x line); omitted: those runners are skipped
  --python-mcp2 <path>  python from a venv with runners/requirements-mcp2.txt (mcp 2.x line); omitted: those runners are skipped
  --only <substring>  run only runners whose id contains this (repeatable)
  --hub-root <dir>      run the throwaway MCPHub from another checkout (e.g. a worktree of an in-flight branch;
                        it needs its own node_modules) instead of this one
  --lifetime <sec>    access token lifetime for the hub (default 6)
  --keep              keep the temp directory (settings, hub log) and print its path
  --list              list runner ids and exit
`;

const parseArgs = (argv) => {
  const args = { only: [], lifetime: 6 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--out') args.out = argv[++i];
    else if (a === '--python') args.python = argv[++i];
    else if (a === '--python-mcp2') args.pythonMcp2 = argv[++i];
    else if (a === '--only') args.only.push(argv[++i]);
    else if (a === '--hub-root') args.hubRoot = argv[++i];
    else if (a === '--lifetime') {
      args.lifetime = Number(argv[++i]);
      if (!Number.isFinite(args.lifetime) || args.lifetime < 1) throw new Error('--lifetime must be a number of seconds >= 1');
    }
    else if (a === '--keep') args.keep = true;
    else if (a === '--list') args.list = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--') continue; // `pnpm compat -- --out x` passes the separator through
    else throw new Error(`unknown option ${a}\n${USAGE}`);
  }
  return args;
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

const gitHead = (dir) => {
  try {
    return execFileSync('git', ['-C', dir, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
};

const killGroup = (child, signal) => {
  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
};

// Each runner gets its own process group, so a timeout takes its helper processes (the Inspector
// CLI, python subprocesses) down with it instead of leaving them holding ports.
const runChild = (cmd, args, env, timeoutMs) =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: repoRoot, env: cleanEnv(env), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup(child, 'SIGKILL');
    }, timeoutMs);
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      killGroup(child, 'SIGKILL'); // stragglers of a runner that exited on its own
      resolve({ code, signal, stdout, stderr, timedOut });
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: String(error), timedOut });
    });
  });

const parseResult = (stdout) => {
  const marker = stdout.lastIndexOf('@@COMPAT_RESULT@@');
  if (marker < 0) return undefined;
  try {
    return JSON.parse(stdout.slice(marker + '@@COMPAT_RESULT@@'.length).trim().split('\n')[0]);
  } catch {
    return undefined;
  }
};

export const summarizeTrace = (entries) => {
  const grants = {};
  const rpc = {};
  const wellKnown = [];
  const protocolHeaders = new Set();
  const metaVersions = new Set();
  const initializeVersions = new Set();
  const grantErrors = [];
  let registrations = 0;
  let mcpUnauthorized = 0;
  for (const e of entries) {
    if (e.path?.startsWith('/.well-known/')) wellKnown.push(`${e.method} ${e.path} -> ${e.status}`);
    if (e.path === '/oauth/register' && e.method === 'POST') registrations += 1;
    if (e.path === '/oauth/token' && e.grantType) {
      const key = `${e.grantType}:${e.status}`;
      grants[key] = (grants[key] ?? 0) + 1;
      if (e.oauthError) grantErrors.push(`${e.grantType}: ${e.oauthError}`);
    }
    if (/^\/mcp/.test(e.path ?? '')) {
      if (e.status === 401) mcpUnauthorized += 1;
      if (e.protocolHeader) protocolHeaders.add(e.protocolHeader);
      if (e.rpcMethod) rpc[e.rpcMethod] = (rpc[e.rpcMethod] ?? 0) + 1;
      if (e.metaProtocolVersion) metaVersions.add(e.metaProtocolVersion);
      if (e.initializeProtocolVersion) initializeVersions.add(e.initializeProtocolVersion);
    }
  }
  return {
    wellKnown: [...new Set(wellKnown)],
    registrations,
    grants,
    grantErrors: [...new Set(grantErrors)],
    mcpUnauthorized,
    rpc,
    protocolHeaders: [...protocolHeaders],
    metaProtocolVersions: [...metaVersions],
    initializeProtocolVersions: [...initializeVersions],
  };
};

const grantCount = (trace, grant, status) => trace.grants[`${grant}:${status}`] ?? 0;

export const main = async (argv) => {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  const allRunners = buildRunners({ repoRoot, python: { mcp1: args.python, mcp2: args.pythonMcp2 } });
  if (args.list) {
    for (const r of allRunners) console.log(`${r.id}${r.python && !r.cmd ? `  (needs --python${r.python === 'mcp2' ? '-mcp2' : ''})` : ''}`);
    return 0;
  }
  for (const p of [args.python, args.pythonMcp2]) if (p && !fs.existsSync(p)) throw new Error(`${p} does not exist`);

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcphub-compat-'));
  console.log(`work dir: ${workDir}`);

  const cimdClientId = 'https://client.compat.test/oauth/client-metadata.json';
  const cimdRedirect = 'http://127.0.0.1:9/callback';
  // The Inspector CLI listens for its callback itself, so its port has to be in the document up front.
  const inspectorCallbackPort = await freePort();
  const inspectorRedirect = `http://127.0.0.1:${inspectorCallbackPort}/oauth/callback`;
  const cimd = {
    clientId: cimdClientId,
    redirectUri: cimdRedirect,
    document: {
      client_id: cimdClientId,
      client_name: 'compat-cimd-client',
      redirect_uris: [cimdRedirect, inspectorRedirect],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    },
  };

  const upstream = await startUpstream();
  let hub;
  try {
    hub = await startHub({ repoRoot, hubRoot: args.hubRoot ? path.resolve(args.hubRoot) : repoRoot, workDir, upstreamUrl: upstream.url, accessTokenLifetime: args.lifetime, cimd });
  } catch (error) {
    await upstream.close();
    if (!args.keep) fs.rmSync(workDir, { recursive: true, force: true });
    throw error;
  }
  const agent = createBrowserAgent({ hubUrl: hub.url, login: hub.login });
  const browserUrl = await agent.start();
  const mcpUrl = `${hub.url}/mcp`;
  console.log(`hub: ${hub.url} (internal ${hub.internalUrl}), upstream: ${upstream.url}`);

  const results = {
    generatedAt: new Date().toISOString(),
    accessTokenLifetime: args.lifetime,
    hubUrl: hub.url,
    hubRoot: args.hubRoot ? path.resolve(args.hubRoot) : repoRoot,
    hubCommit: gitHead(args.hubRoot ? path.resolve(args.hubRoot) : repoRoot),
    probe: undefined,
    runs: [],
  };

  try {
    results.probe = await runDiscoveryProbe({ hubUrl: hub.url, mcpUrl });
    const probeRun = {
      client: 'raw-http probe',
      variant: '',
      versions: { node: process.version },
      steps: {
        discovery: {
          status: 'pass',
          detail: `${results.probe.summary.passed}/${results.probe.checks.length} checks passed`,
        },
      },
      protocol: null,
    };
    const probeFailures = results.probe.checks.filter((c) => c.status === 'fail');
    if (probeFailures.length) {
      const nonGap = probeFailures.filter((c) => !c.gap);
      probeRun.steps.discovery = {
        status: 'fail',
        detail:
          `${results.probe.checks.length - probeFailures.length}/${results.probe.checks.length} checks passed; ` +
          `failing: ${probeFailures.map((c) => `${c.id}${c.gap ? ` [${c.gap}]` : ''}`).join(', ')}`,
        cause: nonGap.length ? 'unclassified' : 'expected-gap',
        note: nonGap.length ? 'a check without an in-flight branch failed' : [...new Set(probeFailures.map((c) => GAP_BRANCHES[c.gap]))].join('; '),
      };
    }
    results.runs.push(probeRun);

    for (const runner of allRunners) {
      if (args.only.length && !args.only.some((s) => runner.id.includes(s))) continue;
      if (runner.python && !runner.cmd) {
        results.runs.push({ client: runner.client, variant: runner.variant, versions: {}, steps: {}, skipped: runner.python === 'mcp2' ? 'needs --python-mcp2' : 'needs --python' });
        continue;
      }
      console.log(`running ${runner.id} ...`);
      const mark = hub.proxy.mark();
      const consentMark = agent.consents.length;
      const ctx = {
        hubUrl: hub.url,
        mcpUrl,
        browserUrl,
        browserSecret: agent.secret,
        accessTokenLifetime: args.lifetime,
        cimd: { clientId: cimd.clientId, redirectUri: cimd.redirectUri, inspectorRedirect, inspectorCallbackPort },
      };
      const cmd = runner.cmd;
      const child = await runChild(cmd, runner.args, { ...runner.env, COMPAT_CTX: JSON.stringify(ctx) }, runner.timeoutMs ?? 240_000);
      const trace = summarizeTrace(hub.proxy.since(mark));
      const run = parseResult(child.stdout) ?? {
        client: runner.client,
        variant: runner.variant,
        versions: {},
        steps: { discovery: { status: 'fail', detail: `runner produced no result${child.timedOut ? ' (killed after the timeout)' : ''}, exit ${child.code}; which step it died in is unknown: ${child.stderr.slice(-400)}` } },
      };
      run.client = runner.client ?? run.client;
      run.variant = runner.variant ?? run.variant;
      run.trace = trace;
      run.consents = agent.consents.length - consentMark;
      if (child.timedOut) run.timedOut = true;
      if (!run.protocol) run.protocol = null;
      applyTraceAssertions(run);
      if (child.code !== 0 && !parseResult(child.stdout)) run.runnerStderr = child.stderr.slice(-2000);
      for (const step of STEPS) {
        const cell = run.steps[step];
        if (cell?.status === 'fail' && !cell.cause) Object.assign(cell, classify({ client: run.client, variant: run.variant, step, detail: cell.detail }));
      }
      results.runs.push(run);
    }
  } finally {
    await agent.stop();
    await hub.stop();
    await upstream.close();
    results.consents = agent.consents;
    if (args.keep) console.log(`kept ${workDir} (hub log: ${hub.logPath})`);
    else fs.rmSync(workDir, { recursive: true, force: true });
  }

  if (args.out) {
    fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
    fs.writeFileSync(args.out, JSON.stringify(results, null, 2));
    console.log(`\nresults written to ${args.out}`);
  }
  console.log(`\n${formatReport(results)}`);
  const failed = results.runs.some((r) => Object.values(r.steps ?? {}).some((c) => c.status === 'fail'));
  return failed ? 1 : 0;
};

// Claims a runner makes about itself are checked against what the proxy saw on the wire.
const applyTraceAssertions = (run) => {
  const t = run.trace;
  const refresh = run.steps.refresh;
  if (refresh?.status === 'pass' && run.consents > 1) {
    run.steps.refresh = {
      status: 'fail',
      detail: `call succeeded only after the user was sent through consent ${run.consents} times: the client logged in again instead of refreshing`,
    };
  }
  if (run.steps.refresh?.status === 'pass' && run.autoRefresh !== false) {
    const ok = grantCount(t, 'refresh_token', 200);
    if (!ok) {
      run.steps.refresh = {
        status: 'fail',
        detail: `runner reported success but no successful refresh_token grant reached /oauth/token (grants: ${JSON.stringify(t.grants)})`,
      };
    } else {
      refresh.detail += `; refresh_token grants seen on the wire: ${ok}; 401s on /mcp: ${t.mcpUnauthorized}`;
    }
  }
  if (run.steps.login?.status === 'fail') {
    const bad = Object.entries(t.grants).filter(([k]) => !k.endsWith(':200'));
    if (bad.length) {
      run.steps.login.detail += ` (on the wire, /oauth/token answered: ${bad.map(([k, n]) => `${k} x${n}`).join(', ')}${t.grantErrors.length ? `; ${t.grantErrors.join(' | ')}` : ''})`;
    }
  }
  const register = run.steps.register;
  if (register?.status === 'pass' && /DCR/.test(register.detail) && t.registrations < 1) {
    run.steps.register = { status: 'fail', detail: 'runner claims DCR but no POST /oauth/register was seen' };
  }
  if (run.steps.discovery?.status === 'pass') {
    const prm = t.wellKnown.some((w) => w.includes('oauth-protected-resource'));
    const asm = t.wellKnown.some((w) => w.includes('oauth-authorization-server') || w.includes('openid-configuration'));
    run.steps.discovery.detail += `; well-known fetched: ${t.wellKnown.join(' | ') || 'none'}`;
    if (!prm || !asm) run.steps.discovery.detail += ' (note: client did not fetch both PRM and AS metadata)';
  }
  if (!run.protocol?.negotiated && (t.initializeProtocolVersions.length || t.metaProtocolVersions.length)) {
    run.protocol = {
      negotiated: t.metaProtocolVersions[0] ?? t.initializeProtocolVersions[0],
      era: t.metaProtocolVersions.length ? 'modern' : 'legacy',
    };
  }
  if (run.protocol?.negotiated && !run.protocol.era) {
    run.protocol.era = run.protocol.negotiated >= '2026-07-28' ? 'modern' : 'legacy';
  }
};
