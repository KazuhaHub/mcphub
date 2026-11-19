import { useEffect, useSyncExternalStore } from 'react';
import {
  fetchCredentialBindings,
  fetchWorkspaceEndpoints,
  fetchWorkspaceServers,
} from '@/services/workspaceService';
import type { MyCredentialBinding, WorkspaceEndpoints, WorkspaceServer } from '@/types';
import { WorkspaceApiError, createLatestOnly, shouldRefreshOnFocus } from '@/utils/workspace';

/**
 * The one place the workspace page reads from: the services list, a service's panel, the Connect
 * card and the Connect dialog all show this data, and nothing else fetches it. Every change
 * (toggle, permission, credential save, sign-in) ends in `refreshWorkspace()`, and coming back to
 * the window refreshes it too, so every view agrees without anyone announcing anything.
 */
export interface WorkspaceData {
  servers: WorkspaceServer[];
  endpoints: WorkspaceEndpoints | null;
  // Null until loaded or when loading failed (`bindingsError` says which).
  bindings: MyCredentialBinding[] | null;
  bindingsError: string;
  loaded: boolean;
  // Set only while nothing has been loaded yet; a failed later refresh keeps the last data.
  error: { detail: string; disabled: boolean } | null;
}

const EMPTY: WorkspaceData = {
  servers: [],
  endpoints: null,
  bindings: null,
  bindingsError: '',
  loaded: false,
  error: null,
};

const FOCUS_DEBOUNCE_MS = 250;

let state: WorkspaceData = EMPTY;
const listeners = new Set<() => void>();
const set = (patch: Partial<WorkspaceData>) => {
  state = { ...state, ...patch };
  for (const listener of [...listeners]) listener();
};

// Only the newest refresh may write; a slow stale one must not undo a newer view.
let latest = createLatestOnly();
let latestBindings = createLatestOnly();
// Changes in flight; a refresh started by returning to the window would carry the pre-change
// state back over them.
let mutations = 0;
let inFlight: Promise<void> | null = null;
let focusTimer: ReturnType<typeof setTimeout> | undefined;

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : '');

/**
 * Fetches everything again. Always starts a new request; the newest one wins. The services show
 * as soon as they arrive; the bindings follow on their own and never hold them back.
 */
export const refreshWorkspace = (): Promise<void> => {
  const services = latest
    .run(
      () => Promise.all([fetchWorkspaceServers(), fetchWorkspaceEndpoints()]),
      ([servers, endpoints]) => set({ servers, endpoints, loaded: true, error: null }),
    )
    .then(
      () => undefined,
      (err: unknown) => {
        if (!state.loaded) {
          set({
            error: {
              detail: errorMessage(err),
              disabled: err instanceof WorkspaceApiError && err.disabled,
            },
          });
        }
      },
    );
  const bindings = latestBindings
    .run(fetchCredentialBindings, (list) => set({ bindings: list, bindingsError: '' }))
    .then(
      () => undefined,
      (err: unknown) => set({ bindingsError: errorMessage(err) || 'failed' }),
    );
  const tracked = Promise.all([services, bindings]).then(() => undefined);
  const done = tracked.finally(() => {
    if (inFlight === done) inFlight = null;
  });
  inFlight = done;
  return done;
};

/** Optimistic edits of the servers; the refresh after the change reconciles them. */
export const updateWorkspaceServers = (
  updater: (servers: WorkspaceServer[]) => WorkspaceServer[],
): void => set({ servers: updater(state.servers) });

/** Runs a change, then refreshes. Refreshes already under way are dropped, not trusted. */
export const mutateWorkspace = async (change: () => Promise<void>): Promise<void> => {
  mutations++;
  latest.invalidate();
  latestBindings.invalidate();
  try {
    await change();
  } finally {
    mutations--;
  }
  await refreshWorkspace();
};

/** Drops all data; for tests and for signing out. */
export const resetWorkspaceStore = (): void => {
  latest.invalidate();
  latestBindings.invalidate();
  latest = createLatestOnly();
  latestBindings = createLatestOnly();
  mutations = 0;
  inFlight = null;
  clearTimeout(focusTimer);
  state = EMPTY;
  for (const listener of [...listeners]) listener();
};

// Whose data the store holds. The store outlives sign-out and sign-in in the same tab, so it is
// dropped whenever the signed-in user changes; another user's data must never be shown.
let owner: string | null = null;

/** Binds the store to the signed-in user (null when signed out); drops its data on any change. */
export const bindWorkspaceStore = (user: string | null): void => {
  if (user === owner) return;
  owner = user;
  resetWorkspaceStore();
};

/** Sets what the page would have loaded; for tests. */
export const seedWorkspaceStore = (data: Partial<WorkspaceData>): void =>
  set({ ...EMPTY, loaded: true, ...data });

const refreshSoon = () => {
  if (!shouldRefreshOnFocus(mutations)) return;
  clearTimeout(focusTimer);
  focusTimer = setTimeout(() => void refreshWorkspace(), FOCUS_DEBOUNCE_MS);
};
const onVisibility = () => {
  if (document.visibilityState === 'visible') refreshSoon();
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  if (listeners.size === 1) {
    window.addEventListener('focus', refreshSoon);
    document.addEventListener('visibilitychange', onVisibility);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.removeEventListener('focus', refreshSoon);
      document.removeEventListener('visibilitychange', onVisibility);
      clearTimeout(focusTimer);
    }
  };
};
const getSnapshot = (): WorkspaceData => state;

/** Reads the shared data without fetching; for views inside a page that already loads it. */
export const useWorkspaceSnapshot = (): WorkspaceData =>
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

/** Reads the shared data and makes sure it is fresh when the view appears. */
export const useWorkspaceData = (): WorkspaceData => {
  const data = useWorkspaceSnapshot();
  useEffect(() => {
    void (inFlight ?? refreshWorkspace());
  }, []);
  return data;
};
