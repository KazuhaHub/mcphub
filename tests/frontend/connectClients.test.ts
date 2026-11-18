import {
  CONNECT_CLIENTS,
  buildClaudeCodeCommand,
  buildCodexCommand,
  buildConnectPlan,
  buildCursorDeepLink,
  buildGeminiCommand,
  buildLmStudioDeepLink,
  buildVsCodeDeepLink,
  canChooseAuth,
  computeTileLayout,
  connectEntryName,
  effectiveAuth,
  getConnectClient,
  shellArg,
  type ConnectClientId,
} from '../../frontend/src/utils/connectClients';

const target = { name: 'mcphub', url: 'https://hub.example.com/alice/mcp' };
const client = (id: ConnectClientId) => getConnectClient(id)!;
const decodeConfig = (link: string): unknown => {
  const config = new URL(link.replace(/^[a-z-]+:\/\//, 'https://')).searchParams.get('config')!;
  return JSON.parse(Buffer.from(config, 'base64').toString('utf8'));
};

describe('client catalogue', () => {
  it('leads with the six headline clients in the agreed order', () => {
    expect(CONNECT_CLIENTS.slice(0, 6).map((c) => c.id)).toEqual([
      'claude',
      'chatgpt',
      'claude-code',
      'cursor',
      'vscode',
      'codex',
    ]);
  });

  it('has unique ids', () => {
    const ids = CONNECT_CLIENTS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('entry names', () => {
  it('uses mcphub for the aggregate and the service name otherwise', () => {
    expect(connectEntryName(null)).toBe('mcphub');
    expect(connectEntryName('  ')).toBe('mcphub');
    expect(connectEntryName('notion')).toBe('notion');
  });
});

describe('commands', () => {
  it('builds the Claude Code HTTP command with no header for OAuth', () => {
    expect(buildClaudeCodeCommand(target)).toBe(
      'claude mcp add --transport http mcphub https://hub.example.com/alice/mcp',
    );
  });

  it('adds a quoted header in key mode', () => {
    expect(buildClaudeCodeCommand(target, { Authorization: 'Bearer <your-access-token>' })).toBe(
      "claude mcp add --transport http mcphub https://hub.example.com/alice/mcp --header 'Authorization: Bearer <your-access-token>'",
    );
  });

  it('quotes unusual names and refuses dash-led values', () => {
    expect(buildClaudeCodeCommand({ name: 'my svc', url: target.url })).toContain("'my svc'");
    expect(buildClaudeCodeCommand({ name: '-x', url: target.url })).toBeUndefined();
    expect(buildCodexCommand({ name: 'a', url: '-bad' })).toBeUndefined();
    expect(shellArg("it's")).toBe("'it'\\''s'");
  });

  it('builds the Codex and Gemini CLI commands', () => {
    expect(buildCodexCommand(target)).toBe(
      'codex mcp add mcphub --url https://hub.example.com/alice/mcp',
    );
    expect(buildGeminiCommand(target)).toBe(
      'gemini mcp add --transport http mcphub https://hub.example.com/alice/mcp',
    );
    expect(buildGeminiCommand(target, { Authorization: 'Bearer x' })).toBe(
      "gemini mcp add --transport http --header 'Authorization: Bearer x' mcphub https://hub.example.com/alice/mcp",
    );
  });
});

describe('deep links', () => {
  it('encodes the Cursor config as base64 of the mcp.json entry', () => {
    const link = buildCursorDeepLink({ name: 'my svc', url: target.url });
    expect(
      link.startsWith('cursor://anysphere.cursor-deeplink/mcp/install?name=my%20svc&config='),
    ).toBe(true);
    expect(decodeConfig(link)).toEqual({ url: target.url });
  });

  it('carries headers in key mode and survives non-ASCII names', () => {
    const headers = { Authorization: 'Bearer <your-access-token>' };
    expect(decodeConfig(buildCursorDeepLink(target, headers))).toEqual({
      url: target.url,
      headers,
    });
    const link = buildLmStudioDeepLink({ name: '服务', url: target.url }, headers);
    expect(link.startsWith('lmstudio://add_mcp?name=%E6%9C%8D%E5%8A%A1&config=')).toBe(true);
    expect(decodeConfig(link)).toEqual({ url: target.url, headers });
  });

  it('builds the VS Code link from URL-encoded JSON', () => {
    const link = buildVsCodeDeepLink(target);
    expect(link.startsWith('vscode:mcp/install?')).toBe(true);
    expect(JSON.parse(decodeURIComponent(link.slice('vscode:mcp/install?'.length)))).toEqual({
      name: 'mcphub',
      type: 'http',
      url: target.url,
    });
  });
});

describe('connect plans', () => {
  it('walks Claude through the custom connector and offers the settings page', () => {
    const plan = buildConnectPlan(client('claude'), target, { auth: 'oauth' });
    expect(plan.kind).toBe('web');
    expect(plan.copyUrl).toBe(target.url);
    expect(plan.settingsUrl).toBe('https://claude.ai/customize/connectors');
    expect(plan.stepKeys).toHaveLength(3);
  });

  it('keeps ChatGPT on OAuth even when a key is requested', () => {
    expect(effectiveAuth(client('chatgpt'), 'key')).toBe('oauth');
    expect(canChooseAuth(client('chatgpt'))).toBe(false);
    const plan = buildConnectPlan(client('chatgpt'), target, { auth: 'key' });
    expect(plan.blocks).toEqual([]);
  });

  it('gives Claude Code one command, plus a header in key mode', () => {
    const oauth = buildConnectPlan(client('claude-code'), target, { auth: 'oauth' });
    expect(oauth.blocks.map((b) => b.text)).toEqual([
      'claude mcp add --transport http mcphub https://hub.example.com/alice/mcp',
    ]);
    const key = buildConnectPlan(client('claude-code'), target, { auth: 'key' });
    expect(key.blocks[0].text).toContain('--header');
    expect(key.noteKeys).toContain('connect.notes.keyPlaceholder');
  });

  it('gives Codex add and login commands for OAuth and a TOML block for keys', () => {
    const oauth = buildConnectPlan(client('codex'), target, { auth: 'oauth' });
    expect(oauth.blocks.map((b) => b.text)).toEqual([
      'codex mcp add mcphub --url https://hub.example.com/alice/mcp',
      'codex mcp login mcphub',
    ]);
    const key = buildConnectPlan(client('codex'), target, { auth: 'key' });
    expect(key.blocks[0].text).toContain('http_headers');
  });

  it('offers a link and a fallback snippet for Cursor and VS Code', () => {
    for (const id of ['cursor', 'vscode'] as const) {
      const plan = buildConnectPlan(client(id), target, { auth: 'oauth' });
      expect(plan.deepLink?.href).toBeTruthy();
      expect(plan.blocks[0].kind).toBe('config');
      expect(plan.blocks[0].text).not.toContain('Authorization');
    }
  });

  it('forces header auth for LM Studio and says so', () => {
    expect(effectiveAuth(client('lmstudio'), 'oauth')).toBe('key');
    const plan = buildConnectPlan(client('lmstudio'), target, { auth: 'oauth' });
    expect(plan.noteKeys).toContain('connect.notes.keyOnly');
    expect(plan.blocks[0].text).toContain('Authorization');
  });

  it('reuses the snippet presets for the remaining clients and flags unverified OAuth', () => {
    const plan = buildConnectPlan(client('windsurf'), target, { auth: 'oauth' });
    expect(plan.kind).toBe('snippet');
    expect(plan.blocks[0].text).toContain(target.url);
    expect(plan.noteKeys).toContain('connect.notes.oauthUnverified');
  });

  it('produces at least one instruction for every client', () => {
    for (const c of CONNECT_CLIENTS) {
      const plan = buildConnectPlan(c, target, { auth: 'oauth' });
      expect(plan.stepKeys.length).toBeGreaterThan(0);
      expect(plan.blocks.length + (plan.copyUrl ? 1 : 0)).toBeGreaterThan(0);
    }
  });
});

describe('computeTileLayout', () => {
  const MIN = 76;
  const GAP = 8;

  it('fits 3 clients plus More at phone width', () => {
    expect(computeTileLayout(343, 16, MIN, GAP)).toEqual({ columns: 4, visible: 3 });
  });

  it('shows more tiles as the container grows', () => {
    expect(computeTileLayout(700, 16, MIN, GAP)).toEqual({ columns: 8, visible: 7 });
  });

  it('never shows more columns than clients plus More', () => {
    expect(computeTileLayout(5000, 16, MIN, GAP)).toEqual({ columns: 17, visible: 16 });
  });

  it('always keeps at least one client beside More', () => {
    expect(computeTileLayout(10, 16, MIN, GAP)).toEqual({ columns: 2, visible: 1 });
  });

  it('shows everything before the width is known', () => {
    expect(computeTileLayout(0, 16, MIN, GAP)).toEqual({ columns: 17, visible: 16 });
  });
});
