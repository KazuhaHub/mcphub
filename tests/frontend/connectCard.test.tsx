import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { ConnectTiles } from '../../frontend/src/components/connect/ConnectCard';
import ConnectDialog from '../../frontend/src/components/connect/ConnectDialog';
import { CONNECT_CLIENTS, computeConnectTileLayout } from '../../frontend/src/utils/connectClients';
import type { WorkspaceEndpoints, WorkspaceServer } from '../../frontend/src/types';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, vars?: Record<string, string>) => (vars?.name ? `${key}:${vars.name}` : key) }),
}));
jest.mock('@/contexts/SettingsContext', () => ({
  useSettings: () => ({ smartRoutingConfig: { enabled: false } }),
}));
jest.mock('@/services/workspaceService', () => ({
  fetchWorkspaceServers: jest.fn(),
  fetchWorkspaceEndpoints: jest.fn(),
}));
jest.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast: jest.fn() }) }));

const noop = () => undefined;
const tiles = (width: number) =>
  renderToStaticMarkup(
    createElement(ConnectTiles, {
      layout: computeConnectTileLayout(width, CONNECT_CLIENTS.length),
      onSelectClient: noop,
      onMore: noop,
    }),
  );
const tileIds = (html: string) =>
  [...html.matchAll(/data-testid="connect-tile-([a-z-]+)"/g)].map((match) => match[1]);

const server = (name: string, code: WorkspaceServer['status']['code'] = 'available'): WorkspaceServer =>
  ({
    name,
    selected: true,
    enabled: true,
    toolCount: 3,
    status: { code, message: '', action: null },
  }) as WorkspaceServer;

const endpoints: WorkspaceEndpoints = {
  aggregate: 'https://hub.example.com/alice/mcp',
  servers: [
    { name: 'notion', url: 'https://hub.example.com/alice/mcp/notion' },
    { name: 'gh', url: 'https://hub.example.com/alice/mcp/gh' },
    { name: 'clash', url: null, conflict: 'group-name' },
  ],
};

const dialog = (initial: Parameters<typeof ConnectDialog>[0]['initial'], servers = [server('notion'), server('gh')]) =>
  renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(ConnectDialog, {
        aggregateUrl: endpoints.aggregate,
        servers,
        endpoints,
        initial,
        onClose: noop,
      }),
    ),
  );

describe('ConnectTiles', () => {
  it('shows three clients and More at phone width, with the headline clients first', () => {
    const ids = tileIds(tiles(343));
    expect(ids).toEqual(['claude', 'chatgpt', 'claude-code', 'more']);
  });

  it('shows more clients on a wide container and always ends with More', () => {
    const ids = tileIds(tiles(1100));
    expect(ids.slice(0, 6)).toEqual(['claude', 'chatgpt', 'claude-code', 'cursor', 'vscode', 'codex']);
    expect(ids[ids.length - 1]).toBe('more');
    expect(ids.length).toBeGreaterThan(8);
  });

  it('draws the OpenAI mark for ChatGPT and keeps letter tiles for Codex and Cherry Studio', () => {
    const html = tiles(1400);
    const tile = (id: string) => html.match(new RegExp(`data-testid="connect-tile-${id}"[^]*?</button>`))?.[0] ?? '';
    expect(tile('chatgpt')).toContain('viewBox="0 0 716 716"');
    expect(tile('codex')).not.toContain('<svg');
    expect(tile('cherry-studio')).not.toContain('<svg');
  });

  it('draws one equal-width column per tile', () => {
    expect(tiles(343)).toContain('repeat(4, minmax(0, 1fr))');
  });
});

describe('ConnectDialog', () => {
  it('opens on the instructions for a tile and points Claude at the aggregate endpoint', () => {
    const html = dialog({ service: null, client: 'claude' });
    expect(html).toContain('https://hub.example.com/alice/mcp');
    expect(html).toContain('connect.steps.claude.add');
    expect(html).toContain('https://claude.ai/customize/connectors');
    expect(html).toContain('connect.useKey');
  });

  it('uses the per-service endpoint and name for a preselected service', () => {
    const html = dialog({ service: 'notion', client: 'claude-code' });
    expect(html).toContain('claude mcp add --transport http notion https://hub.example.com/alice/mcp/notion');
  });

  it('asks for a service first, listing only services with an endpoint as selectable', () => {
    const html = dialog({ pickService: true }, [server('notion'), server('clash')]);
    expect(html).toContain('connect.pickService');
    expect(html).toContain('notion');
    expect(html).toMatch(/<button[^>]*disabled[^>]*>[^]*clash/);
    expect(html).toContain('connect.serviceConflict');
  });

  it('lists only the clients that did not fit, plus Other, from the More tile', () => {
    const html = dialog({ service: null, clientChoices: ['gemini-cli', 'windsurf'] });
    expect(html).toContain('Gemini CLI');
    expect(html).toContain('Windsurf');
    expect(html).not.toContain('Cursor');
    expect(html).toContain('connect.other');
  });

  it('warns when the service needs personal credentials', () => {
    const html = dialog(
      { service: 'notion', client: 'claude' },
      [server('notion', 'needs_auth')],
    );
    expect(html).toContain('connect.needsCredentials:notion');
    expect(html).toContain('connect.bindCredentials');
  });

  it('offers the generic formats for Other', () => {
    const html = dialog({ service: null, client: 'other' });
    expect(html).toContain('id="connect-format"');
    expect(html).toContain('mcpServers');
  });

  it('offers one copy-and-open button for Claude and ChatGPT, with the URL visible as a fallback', () => {
    for (const [id, label, url] of [
      ['claude', 'connect.copyAndOpenClaude', 'https://claude.ai/customize/connectors'],
      ['chatgpt', 'connect.copyAndOpenChatgpt', 'https://chatgpt.com/plugins'],
    ] as const) {
      const html = dialog({ service: null, client: id });
      expect(html).toContain(label);
      expect(html).toContain(`href="${url}"`);
      expect(html).toContain('connect.notes.copiedOnOpen');
      expect(html).toContain('https://hub.example.com/alice/mcp');
    }
  });

  it('shows the Goose button and keeps the tile order with Claude first and ChatGPT second', () => {
    const html = dialog({ service: null, client: 'goose' });
    expect(html).toContain('connect.addToGoose');
    expect(html).toContain('href="goose://extension?');
    const ids = CONNECT_CLIENTS.map((c) => c.id);
    expect(ids.slice(0, 2)).toEqual(['claude', 'chatgpt']);
    expect(ids).toContain('goose');
  });

  it('hides the API key toggle for ChatGPT, which documents OAuth only', () => {
    const html = dialog({ service: null, client: 'chatgpt' });
    expect(html).not.toContain('connect.useKey');
    expect(html).toContain('connect.steps.chatgpt.add');
  });
});
