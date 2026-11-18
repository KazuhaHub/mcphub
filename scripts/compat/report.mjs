#!/usr/bin/env node
// Formatting for the compatibility matrix. Pure functions over the results JSON, so the output
// can be re-rendered from a saved --out file:  node scripts/compat/report.mjs results.json
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { STEPS, STEP_TITLES } from './lib/steps.mjs';

export const CAUSE_TAGS = {
  'expected-gap': 'G',
  mcphub: 'B',
  'client-limitation': 'C',
  harness: 'H',
  unclassified: '?',
};

export const CAUSE_LEGEND = {
  G: 'expected on main: fixed by an in-flight MCPHub branch',
  B: 'MCPHub defect not covered by an in-flight branch',
  C: 'client stack limitation (not an MCPHub problem)',
  H: 'harness limitation (not an MCPHub problem)',
  '?': 'not yet triaged',
};

export const cellText = (cell) => {
  if (!cell) return 'n/a';
  if (cell.status === 'pass') return 'PASS';
  if (cell.status === 'skip') return 'skip';
  if (cell.status === 'na') return 'n/a';
  if (cell.status === 'fail') return `FAIL [${CAUSE_TAGS[cell.cause ?? 'unclassified'] ?? '?'}]`;
  return String(cell.status);
};

export const protocolText = (protocol) => {
  if (!protocol) return '-';
  const bits = [protocol.negotiated, protocol.era].filter(Boolean);
  return bits.length ? bits.join(' ') : '-';
};

export const rowLabel = (run) => (run.variant ? `${run.client} (${run.variant})` : run.client);

const pad = (text, width) => text + ' '.repeat(Math.max(0, width - text.length));

export const formatMatrix = (runs) => {
  const header = ['client', ...STEPS.map((s) => STEP_TITLES[s]), 'protocol'];
  const rows = runs.map((run) => [
    rowLabel(run),
    ...STEPS.map((step) => cellText(run.steps?.[step])),
    protocolText(run.protocol),
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const line = (cells) => `| ${cells.map((c, i) => pad(c, widths[i])).join(' | ')} |`;
  return [line(header), `|${widths.map((w) => '-'.repeat(w + 2)).join('|')}|`, ...rows.map(line)].join('\n');
};

export const formatFailures = (runs) => {
  const out = [];
  for (const run of runs) {
    for (const step of STEPS) {
      const cell = run.steps?.[step];
      if (cell?.status !== 'fail') continue;
      const tag = CAUSE_TAGS[cell.cause ?? 'unclassified'] ?? '?';
      out.push(`- ${rowLabel(run)} / ${STEP_TITLES[step]} [${tag}]: ${cell.detail}${cell.note ? `\n    cause: ${cell.note}` : ''}`);
    }
  }
  return out.join('\n');
};

export const formatProbe = (probe) => {
  if (!probe) return '';
  return probe.checks
    .map((c) => {
      const tag = c.status === 'pass' ? 'PASS' : c.gap ? 'FAIL [G]' : 'FAIL';
      const why = c.status === 'fail' && c.gap ? ` (${c.gap})` : '';
      return `  ${pad(tag, 9)} ${c.title}${why}\n            ${c.detail}`;
    })
    .join('\n');
};

export const formatVersions = (runs) => {
  const seen = new Map();
  for (const run of runs) {
    for (const [name, version] of Object.entries(run.versions ?? {})) {
      if (!seen.has(name)) seen.set(name, new Set());
      seen.get(name).add(version);
    }
  }
  return [...seen.entries()].map(([name, versions]) => `  ${name} ${[...versions].join(', ')}`).join('\n');
};

export const formatReport = (results) => {
  const parts = [];
  parts.push(
    `MCPHub client compatibility (${results.generatedAt}), MCPHub ${results.hubCommit ?? 'unknown'}, access token lifetime ${results.accessTokenLifetime}s`,
  );
  parts.push('');
  parts.push(formatMatrix(results.runs));
  parts.push('');
  parts.push('Legend: PASS | FAIL [cause] | skip (an earlier step failed) | n/a (not applicable or not run)');
  for (const [tag, text] of Object.entries(CAUSE_LEGEND)) parts.push(`  [${tag}] ${text}`);
  const failures = formatFailures(results.runs);
  if (failures) parts.push('', 'Failures:', failures);
  if (results.probe) parts.push('', 'Discovery probe (raw HTTP, client independent):', formatProbe(results.probe));
  const versions = formatVersions(results.runs);
  if (versions) parts.push('', 'Versions:', versions);
  return parts.join('\n');
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: node scripts/compat/report.mjs <results.json>');
    process.exit(2);
  }
  console.log(formatReport(JSON.parse(fs.readFileSync(file, 'utf8'))));
}
