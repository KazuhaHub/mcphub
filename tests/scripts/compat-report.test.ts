import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const projectRoot = path.resolve(__dirname, '../..');
const reportScript = path.join(projectRoot, 'scripts', 'compat', 'report.mjs');

const results = {
  generatedAt: '2026-01-01T00:00:00.000Z',
  hubCommit: 'abc1234',
  accessTokenLifetime: 6,
  probe: {
    checks: [
      { id: 'challenge-401', title: 'POST /mcp without a token answers 401', status: 'pass', detail: 'HTTP 401' },
      {
        id: 'as-cimd',
        title: 'client_id_metadata_document_supported is true',
        status: 'fail',
        detail: 'client_id_metadata_document_supported=undefined',
        gap: 'cimd-advertisement',
      },
    ],
  },
  runs: [
    {
      client: 'ts-sdk',
      variant: 'dcr-auto',
      versions: { '@modelcontextprotocol/client': '2.1.0' },
      protocol: { negotiated: '2026-07-28', era: 'modern' },
      steps: {
        discovery: { status: 'pass', detail: '' },
        register: { status: 'pass', detail: '' },
        login: { status: 'pass', detail: '' },
        list: { status: 'pass', detail: '' },
        call: { status: 'pass', detail: '' },
        refresh: { status: 'pass', detail: '' },
      },
    },
    {
      client: 'py-sdk (mcp 2.x)',
      variant: 'cimd',
      versions: { mcp: '2.3.0' },
      protocol: null,
      steps: {
        discovery: { status: 'pass', detail: '' },
        register: {
          status: 'fail',
          cause: 'expected-gap',
          detail: 'client did not use the CIMD URL as client_id',
          note: 'in-flight branch: CIMD advertisement',
        },
        login: { status: 'skip', detail: 'blocked' },
        list: { status: 'skip', detail: 'blocked' },
        call: { status: 'skip', detail: 'blocked' },
        refresh: { status: 'skip', detail: 'blocked' },
      },
    },
    {
      client: 'inspector-cli',
      variant: 'cimdforced',
      versions: {},
      protocol: null,
      steps: {
        discovery: { status: 'pass', detail: '' },
        register: { status: 'pass', detail: '' },
        login: { status: 'fail', cause: 'mcphub', detail: 'Invalid grant: authorization code is invalid' },
      },
    },
  ],
};

const render = (data: unknown): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compat-report-'));
  const file = path.join(dir, 'results.json');
  try {
    fs.writeFileSync(file, JSON.stringify(data));
    return execFileSync(process.execPath, [reportScript, file], { encoding: 'utf8' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

describe('compat harness report', () => {
  const output = render(results);
  const matrixLines = output.split('\n').filter((line) => line.startsWith('|'));

  it('prints one matrix row per run with a fixed column set', () => {
    expect(matrixLines[0]).toMatch(
      /^\| client +\| 1 discovery \| 2a register \| 2b login \| 3 list \| 4 call \| 5 refresh \| protocol +\|$/,
    );
    expect(matrixLines).toHaveLength(2 + results.runs.length);
    const widths = new Set(matrixLines.map((line) => line.length));
    expect(widths.size).toBe(1);
  });

  it('renders pass, tagged failure, skip and not-run cells', () => {
    const ts = matrixLines.find((line) => line.includes('ts-sdk (dcr-auto)'))!;
    expect(ts).toMatch(/PASS +\| PASS +\| PASS +\| PASS +\| PASS +\| PASS +\| 2026-07-28 modern/);
    const py = matrixLines.find((line) => line.includes('py-sdk (mcp 2.x) (cimd)'))!;
    expect(py).toContain('FAIL [G]');
    expect(py).toContain('skip');
    const inspector = matrixLines.find((line) => line.includes('inspector-cli (cimdforced)'))!;
    expect(inspector).toContain('FAIL [B]');
    expect(inspector).toContain('n/a');
  });

  it('lists every failure with its cause and explains the legend', () => {
    expect(output).toContain('Failures:');
    expect(output).toContain('py-sdk (mcp 2.x) (cimd) / 2a register [G]');
    expect(output).toContain('cause: in-flight branch: CIMD advertisement');
    expect(output).toContain('inspector-cli (cimdforced) / 2b login [B]');
    expect(output).toContain('[G] expected on main');
    expect(output).toContain('MCPHub abc1234');
  });

  it('marks probe checks that an in-flight branch is expected to fix', () => {
    expect(output).toMatch(/PASS +POST \/mcp without a token answers 401/);
    expect(output).toMatch(/FAIL \[G\] +client_id_metadata_document_supported is true \(cimd-advertisement\)/);
  });

  it('prints no Failures section when nothing failed', () => {
    const clean = render({ ...results, probe: undefined, runs: [results.runs[0]] });
    expect(clean).not.toContain('Failures:');
  });
});
