import type {
  MyCredentialBinding,
  ToolRiskLevel,
  WorkspaceActivityPage,
  WorkspaceClient,
  WorkspaceEndpoints,
  WorkspaceReadiness,
  UserServiceEntry,
  WorkspaceServer,
} from '../types';
import {
  WorkspaceApiError,
  buildActivityQuery,
  isWorkspaceDisabledMessage,
  resolveOAuthLaunch,
  type ActivityFilters,
} from '../utils/workspace';
import { apiDelete, apiGet, apiPost, apiPut, type ApiResponse } from '../utils/fetchInterceptor';

// Unwraps `{ success, data }` and turns a failed envelope into an Error.
const unwrap = <T>(result: ApiResponse<T>, _context: string): T => {
  if (!result?.success) {
    throw new WorkspaceApiError(
      result?.message || '',
      isWorkspaceDisabledMessage(result?.message),
      result?.status,
    );
  }
  return result.data as T;
};

export const fetchWorkspaceServers = async (): Promise<WorkspaceServer[]> =>
  unwrap(await apiGet<ApiResponse<WorkspaceServer[]>>('/workspace/servers'), 'servers');

export const fetchWorkspaceEndpoints = async (): Promise<WorkspaceEndpoints> =>
  unwrap(await apiGet<ApiResponse<WorkspaceEndpoints>>('/workspace/endpoints'), 'endpoints');

/** Asks the service now, bypassing the server's five-minute cache. Null when nothing is probed. */
export const checkWorkspaceReadiness = async (name: string): Promise<WorkspaceReadiness | null> =>
  unwrap(
    await apiPost<ApiResponse<{ name: string; readiness: WorkspaceReadiness | null }>>(
      `/workspace/servers/${encodeURIComponent(name)}/readiness/check`,
      {},
    ),
    'readiness',
  ).readiness;

export const saveServerSelection = async (name: string, selected: boolean): Promise<void> => {
  unwrap(
    await apiPut<ApiResponse>(`/workspace/servers/${encodeURIComponent(name)}/selection`, {
      selected,
    }),
    'selection',
  );
};

/** Adds a service to the user's list (switched on) or removes it. */
export const saveServerMembership = async (name: string, added: boolean): Promise<void> => {
  unwrap(
    await apiPut<ApiResponse>(`/workspace/servers/${encodeURIComponent(name)}/membership`, {
      added,
    }),
    'membership',
  );
};

/** Administrator: the services a user can see, with whether each is added and switched on. */
export const fetchUserServices = async (username: string): Promise<UserServiceEntry[]> =>
  unwrap(
    await apiGet<ApiResponse<UserServiceEntry[]>>(
      `/users/${encodeURIComponent(username)}/services`,
    ),
    'user services',
  );

/** Administrator: adds or removes a service for a user, or switches it on or off for them. */
export const saveUserService = async (
  username: string,
  name: string,
  change: { added?: boolean; selected?: boolean },
): Promise<void> => {
  unwrap(
    await apiPut<ApiResponse>(
      `/users/${encodeURIComponent(username)}/services/${encodeURIComponent(name)}`,
      change,
    ),
    'user service',
  );
};

export const saveRiskCeiling = async (name: string, riskCeiling: ToolRiskLevel): Promise<void> => {
  unwrap(
    await apiPut<ApiResponse>(`/workspace/servers/${encodeURIComponent(name)}/risk`, {
      riskCeiling,
    }),
    'risk',
  );
};

export const fetchWorkspaceClients = async (): Promise<WorkspaceClient[]> =>
  unwrap(await apiGet<ApiResponse<WorkspaceClient[]>>('/workspace/clients'), 'clients');

export const revokeWorkspaceClient = async (client: WorkspaceClient): Promise<void> => {
  unwrap(
    await apiDelete<ApiResponse>(
      `/workspace/clients/${client.kind}/${encodeURIComponent(client.id)}`,
    ),
    'revoke',
  );
};

export const revokeAllWorkspaceClients = async (): Promise<void> => {
  unwrap(await apiDelete<ApiResponse>('/workspace/clients'), 'revoke');
};

/** The user's credential bindings for shared servers that have personal credential slots. */
export const fetchCredentialBindings = async (): Promise<MyCredentialBinding[]> =>
  unwrap(await apiGet<ApiResponse<MyCredentialBinding[]>>('/credentials'), 'credentials') || [];

/** Starts (or refreshes) the personal OAuth flow; resolves with the authorization URL if any. */
export const startPersonalOAuth = async (name: string): Promise<string | undefined> => {
  const data = unwrap(
    await apiPost<ApiResponse<{ authorizationUrl?: string }>>(
      `/servers/${encodeURIComponent(name)}/oauth/personal`,
      {},
    ),
    'oauth',
  );
  return data?.authorizationUrl;
};

export type PersonalOAuthResult =
  | { kind: 'started' }
  | { kind: 'link'; url: string }
  | { kind: 'invalid' };

/**
 * Starts the personal sign-in in a new tab. The tab is opened during the click, before any
 * await, because browsers may block popups afterwards; cutting the opener link keeps the
 * identity provider's page from reaching back into this one. A blocked popup comes back as a
 * link to show instead. Throws when the server refuses.
 */
export const launchPersonalOAuth = async (name: string): Promise<PersonalOAuthResult> => {
  const popup = window.open('about:blank', '_blank');
  if (popup) popup.opener = null;
  try {
    const launch = resolveOAuthLaunch(await startPersonalOAuth(name), Boolean(popup));
    if (launch.kind === 'navigate') {
      popup?.location.replace(launch.url);
      return { kind: 'started' };
    }
    popup?.close();
    if (launch.kind === 'link') return { kind: 'link', url: launch.url };
    if (launch.kind === 'invalid') return { kind: 'invalid' };
    return { kind: 'started' };
  } catch (err) {
    popup?.close();
    throw err;
  }
};

export const fetchWorkspaceActivity = async (
  filters: ActivityFilters,
  cursor?: string | null,
): Promise<WorkspaceActivityPage> =>
  unwrap(
    await apiGet<ApiResponse<WorkspaceActivityPage>>(
      `/workspace/activity${buildActivityQuery(filters, cursor)}`,
    ),
    'activity',
  );
