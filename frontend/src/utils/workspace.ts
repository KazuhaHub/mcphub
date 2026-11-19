import type {
  MyCredentialBinding,
  WorkspaceActivityClient,
  WorkspaceActivityItem,
  WorkspaceActivityStatus,
  WorkspaceServer,
  WorkspaceStatusCode,
} from '../types';

/** More tools than this starts to crowd a model's context. */
export const TOOL_COUNT_WARN = 40;
/** Beyond this, suggest smart routing or per-service endpoints. */
export const TOOL_COUNT_STRONG = 80;

export type ToolCountLevel = 'ok' | 'warn' | 'strong';

export const toolCountLevel = (total: number): ToolCountLevel =>
  total > TOOL_COUNT_STRONG ? 'strong' : total > TOOL_COUNT_WARN ? 'warn' : 'ok';

/** Tools a client would see on the personal endpoint: selected services that are available. */
export const countExposedTools = (servers: readonly WorkspaceServer[]): number =>
  servers
    .filter((server) => server.selected && server.status.code === 'available')
    .reduce((sum, server) => sum + (server.toolCount || 0), 0);

export type ServiceAction =
  | { kind: 'none' }
  | { kind: 'select' }
  | { kind: 'credentials'; server: string }
  | { kind: 'oauth'; server: string }
  | { kind: 'contact_admin' }
  | { kind: 'retry_later'; until?: string };

/**
 * Maps a server's status action to what the UI offers. `connect` opens the credential panel
 * for servers with credential slots, and starts the personal OAuth flow otherwise.
 * A disconnected personal OAuth (`revoked`) always reconnects through OAuth.
 * `credentialServers` is null when the list of servers with slots could not be loaded; the
 * credential panel is the safer destination then.
 */
export const resolveServiceAction = (
  server: Pick<WorkspaceServer, 'name' | 'status' | 'hasCredentialSlots'>,
  credentialServers: ReadonlySet<string> | null,
): ServiceAction => {
  switch (server.status.action) {
    case 'select':
      return { kind: 'select' };
    case 'connect': {
      const hasSlots = hasCredentialSlots(server, credentialServers);
      return hasSlots && server.status.code !== 'revoked'
        ? { kind: 'credentials', server: server.name }
        : { kind: 'oauth', server: server.name };
    }
    case 'contact_admin':
      return { kind: 'contact_admin' };
    case 'retry_later':
      return { kind: 'retry_later', until: server.status.until };
    default:
      return { kind: 'none' };
  }
};

export type ServiceChip =
  | 'ready'
  | 'not_enabled'
  | 'needs_signin'
  | 'needs_credentials'
  | 'credentials_outdated'
  | 'credentials_rejected'
  | 'contact_admin'
  | 'unavailable';

export interface ServiceChipState {
  chip: ServiceChip;
  /** The one thing the user can do about it, shown as a button on the row. */
  action: 'signin' | 'credentials' | null;
  /** Signing in again: the service rejected a sign-in that had worked. */
  reauth?: boolean;
}

/**
 * Whether the service takes credentials the user enters (it has slots) rather than a personal
 * sign-in. The server says so; the list of the user's bindings is the fallback for an older
 * server, and the credential panel the safer guess while neither is known.
 */
export const hasCredentialSlots = (
  server: Pick<WorkspaceServer, 'name' | 'hasCredentialSlots'>,
  credentialServers: ReadonlySet<string> | null,
): boolean =>
  server.hasCredentialSlots ?? (credentialServers ? credentialServers.has(server.name) : true);

/**
 * The single state a service row shows. Most important wins: a service the administrator
 * paused, in maintenance or failing is unavailable whatever else is true; one the user has not
 * turned on is simply not enabled; one the user may not hold credentials for needs an
 * administrator; then outdated or rejected credentials, then missing credentials or sign-in,
 * and otherwise ready. Whether the user is sent to the credentials or to a sign-in follows
 * from what the service takes, never from the failure code alone.
 */
export const resolveServiceChip = (
  server: Pick<WorkspaceServer, 'name' | 'status' | 'hasCredentialSlots'>,
  credentialServers: ReadonlySet<string> | null,
  binding?: Pick<MyCredentialBinding, 'stale'>,
): ServiceChipState => {
  const { code, action: statusAction } = server.status;
  if (code === 'paused' || code === 'maintenance' || code === 'error') {
    return { chip: 'unavailable', action: null };
  }
  if (code === 'not_selected') return { chip: 'not_enabled', action: null };
  if (code === 'needs_auth' && statusAction === 'contact_admin') {
    return { chip: 'contact_admin', action: null };
  }
  const slots = hasCredentialSlots(server, credentialServers);
  if (code === 'credential_invalid') {
    if (!slots) return { chip: 'needs_signin', action: 'signin', reauth: true };
    return {
      chip: binding?.stale ? 'credentials_outdated' : 'credentials_rejected',
      action: 'credentials',
    };
  }
  if (binding?.stale && code !== 'revoked') {
    return { chip: 'credentials_outdated', action: 'credentials' };
  }
  if (code === 'needs_auth' || code === 'revoked') {
    const action = resolveServiceAction(server, credentialServers);
    return action.kind === 'credentials'
      ? { chip: 'needs_credentials', action: 'credentials' }
      : { chip: 'needs_signin', action: 'signin' };
  }
  return { chip: 'ready', action: null };
};

export const serviceChipTone = (chip: ServiceChip): StatusTone => {
  switch (chip) {
    case 'ready':
      return 'ok';
    case 'needs_signin':
    case 'needs_credentials':
    case 'contact_admin':
      return 'warn';
    case 'credentials_outdated':
    case 'credentials_rejected':
    case 'unavailable':
      return 'err';
    default:
      return 'muted';
  }
};

/** Where a workspace link that opens one service's credential panel leads. */
export const workspaceCredentialsPath = (server: string): string =>
  `/workspace?credentials=${encodeURIComponent(server)}`;

/** Where a workspace link that opens one service's panel leads. */
export const workspaceServicePath = (server: string): string =>
  `/workspace?service=${encodeURIComponent(server)}`;

/** The binding of one service, or undefined. The panel never shows any other service. */
export const findCredentialBinding = (
  bindings: readonly MyCredentialBinding[],
  serverName: string,
): MyCredentialBinding | undefined => bindings.find((binding) => binding.serverName === serverName);

export const applySelection = (
  servers: readonly WorkspaceServer[],
  name: string,
  selected: boolean,
): WorkspaceServer[] =>
  servers.map((server) => (server.name === name ? { ...server, selected } : server));

export interface ToggleDeps {
  save: (name: string, selected: boolean) => Promise<void>;
  update: (updater: (servers: WorkspaceServer[]) => WorkspaceServer[]) => void;
}

/**
 * Flips the selection in the UI first, then saves it; reverts only that row if saving fails.
 * Resolves true when the change was saved.
 */
export const toggleServerSelection = async (
  name: string,
  selected: boolean,
  deps: ToggleDeps,
): Promise<boolean> => {
  deps.update((servers) => applySelection(servers, name, selected));
  try {
    await deps.save(name, selected);
    return true;
  } catch {
    deps.update((servers) => applySelection(servers, name, !selected));
    return false;
  }
};

/** Smart-routing variant of the personal endpoint. */
export const buildSmartEndpoint = (aggregate: string, smartPath = '$smart'): string =>
  `${aggregate.replace(/\/+$/, '')}/${smartPath}`;

export type StatusTone = 'ok' | 'warn' | 'err' | 'muted';

export const statusTone = (code: WorkspaceStatusCode): StatusTone => {
  switch (code) {
    case 'available':
      return 'ok';
    case 'maintenance':
    case 'needs_auth':
    case 'revoked':
      return 'warn';
    case 'credential_invalid':
    case 'error':
      return 'err';
    default:
      return 'muted';
  }
};

/**
 * Runs async loads so that only the newest one applies its result. `invalidate` drops every
 * load still in flight, e.g. before an optimistic change that a stale response would undo.
 */
export const createLatestOnly = () => {
  let latest = 0;
  return {
    async run<T>(load: () => Promise<T>, apply: (value: T) => void): Promise<boolean> {
      const id = ++latest;
      let value: T;
      try {
        value = await load();
      } catch (error) {
        // A superseded run is no longer wanted, so its failure is not surfaced either.
        if (id !== latest) return false;
        throw error;
      }
      if (id !== latest) return false;
      apply(value);
      return true;
    },
    invalidate(): void {
      latest++;
    },
  };
};

/** A focus refresh would overwrite optimistic rows while a selection save is in flight. */
export const shouldRefreshOnFocus = (pendingSaves: number): boolean => pendingSaves === 0;

export const isHttpUrl = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
};

export type OAuthLaunch =
  | { kind: 'none' }
  | { kind: 'invalid' }
  // The placeholder popup was blocked: show the link so the user can open it themselves.
  | { kind: 'link'; url: string }
  | { kind: 'navigate'; url: string };

export const resolveOAuthLaunch = (url: string | undefined, popupOpened: boolean): OAuthLaunch => {
  if (!url) return { kind: 'none' };
  if (!isHttpUrl(url)) return { kind: 'invalid' };
  return popupOpened ? { kind: 'navigate', url } : { kind: 'link', url };
};

/** Workspace endpoints answer 404 once an administrator turns the mode off. */
export const isWorkspaceDisabledMessage = (message: string | undefined): boolean =>
  /^(not found|http 404)/i.test((message ?? '').trim());

export class WorkspaceApiError extends Error {
  constructor(
    message: string,
    readonly disabled: boolean,
  ) {
    super(message);
    this.name = 'WorkspaceApiError';
  }
}

/** The backend message carries the maintenance end as an ISO instant; show it localized. */
export const localizeStatusMessage = (
  status: { message: string; until?: string },
  format: (iso: string) => string,
): string =>
  status.until ? status.message.split(status.until).join(format(status.until)) : status.message;

/**
 * What a finished read of the settings means for Workspace Mode. A failed read keeps the last
 * known value (off when there is none); a 401 means the session ended rather than a failure.
 */
export const resolveWorkspaceSetting = (
  response:
    | {
        success?: boolean;
        status?: number;
        data?: { systemConfig?: { workspace?: { enabled?: boolean } } };
      }
    | undefined,
  lastKnown?: boolean,
): { enabled: boolean; failed: boolean; signedOut: boolean } => {
  if (response?.success) {
    return {
      enabled: response.data?.systemConfig?.workspace?.enabled === true,
      failed: false,
      signedOut: false,
    };
  }
  const signedOut = response?.status === 401;
  return { enabled: lastKnown ?? false, failed: !signedOut, signedOut };
};

/** Keeps authorization links only for servers that still need the user to connect. */
export const pruneAuthLinks = (
  links: Record<string, string>,
  servers: readonly WorkspaceServer[],
): Record<string, string> => {
  const needing = new Set(
    servers.filter((server) => server.status.action === 'connect').map((server) => server.name),
  );
  const kept = Object.entries(links).filter(([name]) => needing.has(name));
  return kept.length === Object.keys(links).length ? links : Object.fromEntries(kept);
};

export const ACTIVITY_PAGE_SIZE = 25;

export interface ActivityFilters {
  server?: string;
  status?: WorkspaceActivityStatus;
  /** `<kind>:<id>`, as produced by `activityClientValue`. */
  client?: string;
}

export const activityClientValue = (client: Pick<WorkspaceActivityClient, 'kind' | 'id'>): string =>
  `${client.kind}:${client.id}`;

/** Query string for the activity endpoint; empty filters are left out. */
export const buildActivityQuery = (
  filters: ActivityFilters,
  cursor?: string | null,
  limit: number = ACTIVITY_PAGE_SIZE,
): string => {
  const params = new URLSearchParams({ limit: String(limit) });
  if (filters.server) params.set('server', filters.server);
  if (filters.status) params.set('status', filters.status);
  if (filters.client) {
    const split = filters.client.indexOf(':');
    if (split > 0) {
      params.set('clientKind', filters.client.slice(0, split));
      params.set('clientId', filters.client.slice(split + 1));
    }
  }
  if (cursor) params.set('cursor', cursor);
  return `?${params.toString()}`;
};

/** Adds a later page after the rows already shown, skipping any row that is already there. */
export const appendActivityItems = (
  current: readonly WorkspaceActivityItem[],
  next: readonly WorkspaceActivityItem[],
): WorkspaceActivityItem[] => {
  const seen = new Set(current.map((item) => item.id));
  return [...current, ...next.filter((item) => !seen.has(item.id))];
};

/** Translation key for the reason column, or null when the call needs none. */
export const activityReasonKey = (
  item: Pick<WorkspaceActivityItem, 'status' | 'reason'>,
): string | null => {
  if (!item.reason || item.status === 'success') return null;
  return item.status === 'blocked'
    ? `workspacePage.status.${item.reason}`
    : `workspacePage.activity.reason.${item.reason}`;
};

/** Filter choices: what the user can see now plus anything the loaded history mentions. */
export const mergeActivityOptions = (
  known: readonly string[],
  items: readonly WorkspaceActivityItem[],
  selected?: string,
): string[] =>
  [
    ...new Set([...known, ...items.map((item) => item.server), ...(selected ? [selected] : [])]),
  ].sort((a, b) => a.localeCompare(b));

export interface ActivityClientOption {
  value: string;
  name: string | null;
}

export const mergeActivityClientOptions = (
  known: ReadonlyArray<{ kind: 'oauth' | 'key'; id: string; name: string }>,
  items: readonly WorkspaceActivityItem[],
  selected?: string,
): ActivityClientOption[] => {
  const options = new Map<string, ActivityClientOption>();
  for (const client of known) {
    options.set(activityClientValue(client), {
      value: activityClientValue(client),
      name: client.name,
    });
  }
  for (const item of items) {
    if (!item.client) continue;
    const value = activityClientValue(item.client);
    if (!options.has(value) || (!options.get(value)!.name && item.client.name)) {
      options.set(value, { value, name: item.client.name });
    }
  }
  if (selected && !options.has(selected)) options.set(selected, { value: selected, name: null });
  return [...options.values()];
};
