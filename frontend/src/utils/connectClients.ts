/**
 * "Connect your AI": which clients the workspace offers and the shortest documented way to
 * connect each one to an MCPHub endpoint (the user's aggregate endpoint or one service).
 *
 * Every client fact below was checked against the vendor's own documentation on 2026-11-18.
 * What could not be verified is called out per client; nothing here is guessed.
 *
 * - Claude (claude.ai web, desktop app; custom connector):
 *   https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp
 *   Pro/Max path: Customize > Connectors > "+ Add" > "Add custom connector", enter a name and the
 *   server URL, Continue, then choose the authentication; "Request headers" carry fixed
 *   credentials such as a bearer token. Settings page for Pro and Max: https://claude.ai/customize/connectors
 *   (Team and Enterprise owners add it under Organization settings > Connectors first, and members then
 *   connect it). Claude connects from Anthropic's cloud, so the hub must be reachable over public
 *   HTTPS on port 443. The article does not describe adding connectors from the mobile apps (it
 *   only notes they use the same network path), so the mobile apps are not claimed here.
 * - ChatGPT: https://developers.openai.com/api/docs/guides/developer-mode and
 *   https://developers.openai.com/api/docs/mcp . Path: chatgpt.com/plugins > plus button > "Add custom
 *   MCP server", then name, "Server URL", authentication ("OAuth", "No authentication" or "OAuth or no
 *   authentication"), accept the risk warning, "Create as a plugin", then install it. The pages do not
 *   mention a developer-mode toggle, a Settings path or plan availability, and document no header or
 *   API-key option, so this preset offers OAuth only.
 * - Claude Code: https://code.claude.com/docs/en/mcp . `claude mcp add --transport http <name> <url>`,
 *   `--header "Authorization: Bearer ..."` for a token, `/mcp` inside Claude Code (or
 *   `claude mcp login <name>`) to complete OAuth.
 * - Cursor: https://cursor.com/docs/context/mcp/install-links . Link format
 *   `cursor://anysphere.cursor-deeplink/mcp/install?name=$NAME&config=$BASE64_ENCODED_CONFIG`, where the
 *   config is the server entry in `mcp.json` shape, JSON.stringify'd and base64 encoded. The page's
 *   only example is a stdio server; the remote `{ "url": ..., "headers": ... }` entry shape comes
 *   from https://cursor.com/docs/mcp . Cursor registers OAuth clients dynamically when no static
 *   credentials are given (same page).
 * - VS Code: https://code.visualstudio.com/api/extension-guides/ai/mcp . Link format
 *   `vscode:mcp/install?{json}` with the JSON stringified and URL encoded (`vscode-insiders:` for
 *   Insiders); it opens the server details editor so the user reviews before installing. The page's
 *   example payload is a stdio entry; a remote payload of `{ name, type: "http", url }` follows the
 *   `servers` entry shape on https://code.visualstudio.com/docs/agents/reference/mcp-configuration
 *   but that exact remote link form is not shown in the docs. `code --add-mcp '<json>'` is the CLI
 *   alternative on the same reference page.
 * - Codex: https://learn.chatgpt.com/docs/extend/mcp?surface=cli (developers.openai.com/codex/mcp
 *   redirects there). `codex mcp add <name> --url <url>` (the page shows `--url` in its OAuth example),
 *   then `codex mcp login <name>` for OAuth. Static headers are not available from `codex mcp add`;
 *   the config.toml form takes `bearer_token_env_var` or `http_headers`.
 * - Gemini CLI: https://geminicli.com/docs/tools/mcp-server/ . `gemini mcp add --transport http <name> <url>`
 *   with `--header "..."` for tokens, and `/mcp auth <name>` for OAuth.
 * - LM Studio: https://lmstudio.ai/docs/app/mcp and https://lmstudio.ai/docs/app/mcp/deeplink . Link format
 *   `lmstudio://add_mcp?name=<name>&config=<base64 JSON>` with the `mcp.json` entry (`url`, `headers`).
 *   The docs only describe header-based auth, so OAuth is not claimed for it.
 * - Cherry Studio, OpenCode, Windsurf, Trae, CodeBuddy, Qoder, ZCode, WorkBuddy: no one-click link or
 *   command was verified (Cherry Studio's `mcpProtocolInstall.ts` validates a protocol-install payload but
 *   its docs do not document the link, so no link is built). They reuse the configuration snippets in
 *   mcpClientSnippets.ts, whose sources are listed there. Whether each of those clients can sign in
 *   through OAuth was not verified, so the dialog says so rather than promising it.
 */

import {
  ACCESS_TOKEN_PLACEHOLDER,
  buildClientSnippetBlocks,
  type ClientSnippetBlock,
  type ClientSnippetId,
} from './mcpClientSnippets';

export type ConnectClientId =
  | 'claude'
  | 'chatgpt'
  | 'claude-code'
  | 'cursor'
  | 'vscode'
  | 'codex'
  | 'gemini-cli'
  | 'lmstudio'
  | 'opencode'
  | 'windsurf'
  | 'cherry-studio'
  | 'codebuddy'
  | 'qoder'
  | 'trae'
  | 'zcode'
  | 'workbuddy';

export type ConnectAuthMode = 'oauth' | 'key';

export interface ConnectClient {
  id: ConnectClientId;
  /** Brand name; not translated. */
  name: string;
  /** Key into the vendored brand marks; absent means a letter tile. */
  icon?: string;
  letter: string;
  /** Snippet preset used when the client has no command or link of its own. */
  snippetId?: ClientSnippetId;
  /** Whether the documented client can use a header credential instead of OAuth. */
  supportsKey: boolean;
  /** Whether OAuth sign-in is documented for the client (false: unverified or unsupported). */
  oauth: 'documented' | 'unverified' | 'unsupported';
}

/** Tile order is fixed: the six headline clients, then the rest. Every tile is equal. */
export const CONNECT_CLIENTS: readonly ConnectClient[] = [
  { id: 'claude', name: 'Claude', icon: 'claude', letter: 'C', supportsKey: true, oauth: 'documented' },
  { id: 'chatgpt', name: 'ChatGPT', letter: 'G', supportsKey: false, oauth: 'documented' },
  {
    id: 'claude-code',
    name: 'Claude Code',
    icon: 'claudecode',
    letter: 'C',
    snippetId: 'claude-code',
    supportsKey: true,
    oauth: 'documented',
  },
  {
    id: 'cursor',
    name: 'Cursor',
    icon: 'cursor',
    letter: 'C',
    snippetId: 'cursor',
    supportsKey: true,
    oauth: 'documented',
  },
  {
    id: 'vscode',
    name: 'VS Code',
    icon: 'vscode',
    letter: 'V',
    snippetId: 'vscode',
    supportsKey: true,
    oauth: 'unverified',
  },
  {
    id: 'codex',
    name: 'Codex',
    letter: 'X',
    snippetId: 'codex',
    supportsKey: true,
    oauth: 'documented',
  },
  {
    id: 'gemini-cli',
    name: 'Gemini CLI',
    icon: 'googlegemini',
    letter: 'G',
    supportsKey: true,
    oauth: 'documented',
  },
  {
    id: 'lmstudio',
    name: 'LM Studio',
    icon: 'lmstudio',
    letter: 'L',
    supportsKey: true,
    oauth: 'unsupported',
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    icon: 'opencode',
    letter: 'O',
    snippetId: 'opencode',
    supportsKey: true,
    oauth: 'unverified',
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    icon: 'windsurf',
    letter: 'W',
    snippetId: 'windsurf',
    supportsKey: true,
    oauth: 'unverified',
  },
  {
    id: 'cherry-studio',
    name: 'Cherry Studio',
    letter: 'C',
    snippetId: 'cherry-studio',
    supportsKey: true,
    oauth: 'unverified',
  },
  {
    id: 'trae',
    name: 'Trae',
    icon: 'trae',
    letter: 'T',
    snippetId: 'trae',
    supportsKey: true,
    oauth: 'unverified',
  },
  {
    id: 'codebuddy',
    name: 'CodeBuddy',
    letter: 'C',
    snippetId: 'codebuddy',
    supportsKey: true,
    oauth: 'unverified',
  },
  {
    id: 'qoder',
    name: 'Qoder',
    letter: 'Q',
    snippetId: 'qoder',
    supportsKey: true,
    oauth: 'unverified',
  },
  {
    id: 'zcode',
    name: 'ZCode',
    letter: 'Z',
    snippetId: 'zcode',
    supportsKey: true,
    oauth: 'unverified',
  },
  {
    id: 'workbuddy',
    name: 'WorkBuddy',
    letter: 'W',
    snippetId: 'workbuddy',
    supportsKey: true,
    oauth: 'unverified',
  },
];

export const getConnectClient = (id: ConnectClientId): ConnectClient | undefined =>
  CONNECT_CLIENTS.find((client) => client.id === id);

/** Stable settings page for adding a Claude custom connector (Pro and Max). */
export const CLAUDE_CONNECTORS_URL = 'https://claude.ai/customize/connectors';
/** Where ChatGPT adds a custom MCP server. */
export const CHATGPT_PLUGINS_URL = 'https://chatgpt.com/plugins';

export interface ConnectTarget {
  /** Name the client stores the server under. */
  name: string;
  url: string;
}

/** Name for a client's entry: the service's own name, or `mcphub` for the aggregate endpoint. */
export const connectEntryName = (service: string | null | undefined): string =>
  service && service.trim() ? service.trim() : 'mcphub';

/** Authorization header form used by the "API key" toggle; the key itself stays a placeholder. */
export const keyHeaders = (): Record<string, string> => ({
  Authorization: `Bearer ${ACCESS_TOKEN_PLACEHOLDER}`,
});

const utf8Base64 = (text: string): string => {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
};

/** The server entry shared by Cursor and LM Studio (`mcp.json` notation). */
const mcpJsonEntry = (url: string, headers?: Record<string, string>) => ({
  url,
  ...(headers ? { headers } : {}),
});

export const buildCursorDeepLink = (
  target: ConnectTarget,
  headers?: Record<string, string>,
): string =>
  `cursor://anysphere.cursor-deeplink/mcp/install?name=${encodeURIComponent(target.name)}&config=${encodeURIComponent(
    utf8Base64(JSON.stringify(mcpJsonEntry(target.url, headers))),
  )}`;

export const buildVsCodeDeepLink = (
  target: ConnectTarget,
  headers?: Record<string, string>,
): string =>
  `vscode:mcp/install?${encodeURIComponent(
    JSON.stringify({ name: target.name, type: 'http', url: target.url, ...(headers ? { headers } : {}) }),
  )}`;

export const buildLmStudioDeepLink = (
  target: ConnectTarget,
  headers?: Record<string, string>,
): string =>
  `lmstudio://add_mcp?name=${encodeURIComponent(target.name)}&config=${encodeURIComponent(
    utf8Base64(JSON.stringify(mcpJsonEntry(target.url, headers))),
  )}`;

const SHELL_SAFE = /^[A-Za-z0-9._:@/=-]+$/;

/** POSIX single-quote quoting for pasted commands. */
export const shellArg = (value: string): string =>
  SHELL_SAFE.test(value) ? value : `'${value.replace(/'/g, "'\\''")}'`;

const dashLeading = (target: ConnectTarget): boolean =>
  target.name.startsWith('-') || target.url.startsWith('-');

/** `claude mcp add --transport http <name> <url> [--header ...]`; undefined when a dash-led value would be misparsed. */
export const buildClaudeCodeCommand = (
  target: ConnectTarget,
  headers?: Record<string, string>,
): string | undefined => {
  if (dashLeading(target)) return undefined;
  const parts = ['claude', 'mcp', 'add', '--transport', 'http', shellArg(target.name), shellArg(target.url)];
  for (const [name, value] of Object.entries(headers ?? {})) {
    parts.push('--header', shellArg(`${name}: ${value}`));
  }
  return parts.join(' ');
};

/** `codex mcp add <name> --url <url>`; headers are not an option of this command. */
export const buildCodexCommand = (target: ConnectTarget): string | undefined =>
  dashLeading(target) ? undefined : `codex mcp add ${shellArg(target.name)} --url ${shellArg(target.url)}`;

export const buildCodexLoginCommand = (target: ConnectTarget): string =>
  `codex mcp login ${shellArg(target.name)}`;

/** `gemini mcp add --transport http <name> <url> [--header ...]`. */
export const buildGeminiCommand = (
  target: ConnectTarget,
  headers?: Record<string, string>,
): string | undefined => {
  if (dashLeading(target)) return undefined;
  const parts = ['gemini', 'mcp', 'add', '--transport', 'http'];
  for (const [name, value] of Object.entries(headers ?? {})) {
    parts.push('--header', shellArg(`${name}: ${value}`));
  }
  parts.push(shellArg(target.name), shellArg(target.url));
  return parts.join(' ');
};

export interface ConnectDeepLink {
  href: string;
  /** Translation key of the button label. */
  labelKey: string;
}

export interface ConnectPlan {
  /** Whether the client is an app with a settings screen (steps) rather than a CLI or config file. */
  kind: 'web' | 'cli' | 'link' | 'snippet';
  /** Translation keys of the short steps, in order. */
  stepKeys: string[];
  /** Page that opens the client's connector settings, when a stable URL is documented. */
  settingsUrl?: string;
  /** Translation key for the settings button. */
  settingsLabelKey?: string;
  deepLink?: ConnectDeepLink;
  /** Copyable commands and configuration. */
  blocks: ClientSnippetBlock[];
  /** Translation keys of notes shown under the instructions. */
  noteKeys: string[];
  /** The value to copy for web clients, which paste the URL into a form. */
  copyUrl?: string;
}

export interface ConnectOptions {
  auth: ConnectAuthMode;
}

const snippetBlocks = (
  client: ConnectClient,
  target: ConnectTarget,
  headers: Record<string, string> | undefined,
  tokenPromptDescription?: string,
): ClientSnippetBlock[] =>
  client.snippetId
    ? buildClientSnippetBlocks(
        client.snippetId,
        { name: target.name, url: target.url, type: 'streamable-http', ...(headers ? { headers } : {}) },
        tokenPromptDescription ? { tokenPromptDescription } : {},
      )
    : [];

const commandBlock = (text: string | undefined): ClientSnippetBlock[] =>
  text ? [{ kind: 'command', text }] : [];

/** The auth mode actually applied: a client that cannot do what was asked falls back to what it can. */
export const effectiveAuth = (client: ConnectClient, requested: ConnectAuthMode): ConnectAuthMode => {
  if (requested === 'key' && !client.supportsKey) return 'oauth';
  if (requested === 'oauth' && client.oauth === 'unsupported') return 'key';
  return requested;
};

/** Whether the "use an API key instead" toggle is meaningful for this client. */
export const canChooseAuth = (client: ConnectClient): boolean =>
  client.supportsKey && client.oauth !== 'unsupported';

export const buildConnectPlan = (
  client: ConnectClient,
  target: ConnectTarget,
  options: ConnectOptions,
  tokenPromptDescription?: string,
): ConnectPlan => {
  const auth = effectiveAuth(client, options.auth);
  const headers = auth === 'key' ? keyHeaders() : undefined;
  const noteKeys: string[] = [];
  if (auth === 'key') noteKeys.push('connect.notes.keyPlaceholder');
  if (auth === 'oauth' && client.oauth === 'unverified') noteKeys.push('connect.notes.oauthUnverified');
  if (client.oauth === 'unsupported') noteKeys.push('connect.notes.keyOnly');

  switch (client.id) {
    case 'claude':
      return {
        kind: 'web',
        stepKeys:
          auth === 'key'
            ? [
                'connect.steps.claude.open',
                'connect.steps.claude.addKey',
                'connect.steps.claude.header',
              ]
            : ['connect.steps.claude.open', 'connect.steps.claude.add', 'connect.steps.claude.connect'],
        settingsUrl: CLAUDE_CONNECTORS_URL,
        settingsLabelKey: 'connect.openClaude',
        copyUrl: target.url,
        blocks: auth === 'key' ? [{ kind: 'config', text: `Authorization: ${headers?.Authorization}` }] : [],
        noteKeys: [...noteKeys, 'connect.notes.claudePublic'],
      };
    case 'chatgpt':
      return {
        kind: 'web',
        stepKeys: ['connect.steps.chatgpt.open', 'connect.steps.chatgpt.add', 'connect.steps.chatgpt.auth'],
        settingsUrl: CHATGPT_PLUGINS_URL,
        settingsLabelKey: 'connect.openChatgpt',
        copyUrl: target.url,
        blocks: [],
        noteKeys,
      };
    case 'claude-code':
      return {
        kind: 'cli',
        stepKeys: auth === 'key' ? ['connect.steps.cli.run'] : ['connect.steps.cli.run', 'connect.steps.claudeCode.signIn'],
        blocks: commandBlock(buildClaudeCodeCommand(target, headers)),
        noteKeys,
      };
    case 'cursor':
      return {
        kind: 'link',
        stepKeys: ['connect.steps.link.click', 'connect.steps.link.review'],
        deepLink: { href: buildCursorDeepLink(target, headers), labelKey: 'connect.addToCursor' },
        blocks: snippetBlocks(client, target, headers),
        noteKeys: [...noteKeys, 'connect.notes.fallbackSnippet'],
      };
    case 'vscode':
      return {
        kind: 'link',
        stepKeys: ['connect.steps.link.click', 'connect.steps.link.review'],
        deepLink: { href: buildVsCodeDeepLink(target, headers), labelKey: 'connect.addToVsCode' },
        blocks: snippetBlocks(client, target, headers, tokenPromptDescription),
        noteKeys: [...noteKeys, 'connect.notes.fallbackSnippet'],
      };
    case 'codex': {
      if (auth === 'key') {
        return {
          kind: 'snippet',
          stepKeys: ['connect.steps.codex.config'],
          blocks: snippetBlocks(client, target, headers),
          noteKeys,
        };
      }
      return {
        kind: 'cli',
        stepKeys: ['connect.steps.cli.run', 'connect.steps.codex.login'],
        blocks: [
          ...commandBlock(buildCodexCommand(target)),
          { kind: 'command', text: buildCodexLoginCommand(target) },
        ],
        noteKeys,
      };
    }
    case 'gemini-cli':
      return {
        kind: 'cli',
        stepKeys: auth === 'key' ? ['connect.steps.cli.run'] : ['connect.steps.cli.run', 'connect.steps.gemini.auth'],
        blocks: [
          ...commandBlock(buildGeminiCommand(target, headers)),
          ...(auth === 'oauth' ? [{ kind: 'command' as const, text: `/mcp auth ${target.name}` }] : []),
        ],
        noteKeys,
      };
    case 'lmstudio':
      return {
        kind: 'link',
        stepKeys: ['connect.steps.link.click', 'connect.steps.link.review'],
        deepLink: {
          href: buildLmStudioDeepLink(target, headers ?? keyHeaders()),
          labelKey: 'connect.addToLmStudio',
        },
        blocks: buildClientSnippetBlocks('generic-mcp-servers', {
          name: target.name,
          url: target.url,
          headers: headers ?? keyHeaders(),
        }),
        noteKeys,
      };
    default:
      return {
        kind: 'snippet',
        stepKeys: ['connect.steps.snippet.paste'],
        blocks: snippetBlocks(client, target, headers, tokenPromptDescription),
        noteKeys,
      };
  }
};

/** Snippet blocks for the "Other" entry: any of the generic or per-client formats. */
export const buildOtherSnippet = (
  id: ClientSnippetId,
  target: ConnectTarget,
  auth: ConnectAuthMode,
  tokenPromptDescription?: string,
): ClientSnippetBlock[] =>
  buildClientSnippetBlocks(
    id,
    {
      name: target.name,
      url: target.url,
      type: 'streamable-http',
      ...(auth === 'key' ? { headers: keyHeaders() } : {}),
    },
    tokenPromptDescription ? { tokenPromptDescription } : {},
  );

export interface TileLayout {
  /** Grid columns to draw; the last one is always the More tile. */
  columns: number;
  /** How many client tiles fit before the More tile. */
  visible: number;
}

/**
 * Fits as many equal tiles as the container holds in one row. The last slot is always "More",
 * so `visible` is one less than the columns. Columns never exceed what the clients need
 * (every client plus More), and at least two are kept so the row never collapses to just "More".
 */
export const computeTileLayout = (
  containerWidth: number,
  clientCount: number,
  minTileWidth: number,
  gap: number,
): TileLayout => {
  const needed = clientCount + 1;
  const fits =
    containerWidth > 0 && minTileWidth > 0
      ? Math.floor((containerWidth + gap) / (minTileWidth + gap))
      : needed;
  const columns = Math.max(2, Math.min(needed, fits));
  return { columns, visible: Math.min(clientCount, columns - 1) };
};
