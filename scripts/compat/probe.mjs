#!/usr/bin/env node
// Run only the client-independent discovery probe against any MCPHub MCP endpoint, e.g. before a
// manual test with a hosted client (Claude, ChatGPT, Cursor, VS Code, ...):
//   node scripts/compat/probe.mjs https://hub.example.com/mcp
// It sends unauthenticated requests and an invalid token only; it never logs in.
import { formatProbe } from './report.mjs';
import { runDiscoveryProbe } from './lib/probe.mjs';

const mcpUrl = process.argv[2];
if (!mcpUrl) {
  console.error('usage: node scripts/compat/probe.mjs <MCP endpoint URL>');
  process.exit(2);
}
// Strip the MCP route (`/mcp` or `/mcp/<group>`), keeping any deployment prefix.
const hubUrl = mcpUrl.replace(/\/mcp(\/[^/]+)?\/?$/, '');
const result = await runDiscoveryProbe({ hubUrl, mcpUrl });
console.log(formatProbe(result));
console.log(`\n${result.summary.passed}/${result.checks.length} checks passed`);
process.exit(result.summary.requiredFailed ? 1 : 0);
