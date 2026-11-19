import type {
  WorkspaceServer,
  WorkspaceStatusAction,
  WorkspaceStatusCode,
} from '../../frontend/src/types';
import {
  applySelection,
  buildSmartEndpoint,
  createLatestOnly,
  isHttpUrl,
  pruneAuthLinks,
  isWorkspaceDisabledMessage,
  localizeStatusMessage,
  resolveOAuthLaunch,
  resolveWorkspaceSetting,
  shouldRefreshOnFocus,
  countExposedTools,
  resolveServiceChip,
  toolCountLevel,
  workspaceServicePath,
  findCredentialBinding,
  workspaceCredentialsPath,
  resolveServiceAction,
  toggleServerSelection,
} from '../../frontend/src/utils/workspace';

const server = (
  name: string,
  code: WorkspaceStatusCode,
  action: WorkspaceStatusAction,
  extra: Partial<WorkspaceServer> = {},
): WorkspaceServer => ({
  name,
  selected: code !== 'not_selected',
  enabled: true,
  toolCount: 5,
  riskCeiling: 'read',
  riskCeilingIsDefault: false,
  riskCounts: { read: 5, write: 0, external: 0 },
  maxAllowedRisk: 'external',
  annotationsTrusted: true,
  requiresPersonalCredential: false,
  credentialConfigured: true,
  status: { code, message: `${name} ${code}`, action },
  ...extra,
});

describe('exposed tools', () => {
  it('counts tools of selected, available services only', () => {
    const servers = [
      server('a', 'available', null, { toolCount: 10 }),
      server('b', 'needs_auth', 'connect', { toolCount: 30 }),
      server('c', 'not_selected', 'select', { toolCount: 50, selected: false }),
      server('d', 'available', null, { toolCount: 7 }),
    ];
    expect(countExposedTools(servers)).toBe(17);
  });
});

describe('action mapping per status code', () => {
  const credentialServers = new Set(['slots']);

  it.each([
    ['available', null, { kind: 'none' }],
    ['not_selected', 'select', { kind: 'select' }],
    ['paused', 'contact_admin', { kind: 'contact_admin' }],
    ['maintenance', 'retry_later', { kind: 'retry_later', until: undefined }],
    ['error', 'retry_later', { kind: 'retry_later', until: undefined }],
  ] as const)('%s -> %p', (code, action, expected) => {
    expect(resolveServiceAction(server('s', code, action), credentialServers)).toEqual(expected);
  });

  it('passes the maintenance end time through', () => {
    const s = server('s', 'maintenance', 'retry_later');
    s.status.until = '2026-11-01T00:00:00.000Z';
    expect(resolveServiceAction(s, credentialServers)).toEqual({
      kind: 'retry_later',
      until: '2026-11-01T00:00:00.000Z',
    });
  });

  it('routes connect to the credentials page for servers with credential slots', () => {
    for (const code of ['needs_auth', 'credential_invalid'] as const) {
      expect(resolveServiceAction(server('slots', code, 'connect'), credentialServers)).toEqual({
        kind: 'credentials',
        server: 'slots',
      });
    }
  });

  it('routes connect to personal OAuth for servers without credential slots', () => {
    for (const code of ['needs_auth', 'revoked', 'credential_invalid'] as const) {
      expect(resolveServiceAction(server('gitlab', code, 'connect'), credentialServers)).toEqual({
        kind: 'oauth',
        server: 'gitlab',
      });
    }
  });

  it('reconnects a disconnected personal OAuth through OAuth even if slots exist', () => {
    expect(resolveServiceAction(server('slots', 'revoked', 'connect'), credentialServers)).toEqual({
      kind: 'oauth',
      server: 'slots',
    });
  });

  it('falls back to the credentials page when the slot list is unknown', () => {
    expect(resolveServiceAction(server('x', 'needs_auth', 'connect'), null)).toEqual({
      kind: 'credentials',
      server: 'x',
    });
  });

  it('honours an overridden action such as contact_admin on needs_auth', () => {
    expect(
      resolveServiceAction(server('x', 'needs_auth', 'contact_admin'), credentialServers),
    ).toEqual({ kind: 'contact_admin' });
  });

  it('builds a workspace link that opens one service’s credential panel', () => {
    expect(workspaceCredentialsPath('my server')).toBe('/workspace?credentials=my%20server');
  });

  it('builds a workspace link that opens one service’s panel', () => {
    expect(workspaceServicePath('my server')).toBe('/workspace?service=my%20server');
  });

  it('finds the binding of exactly one service', () => {
    const bindings = [{ serverName: 'a' }, { serverName: 'b' }] as never[];
    expect(findCredentialBinding(bindings, 'b')).toBe(bindings[1]);
    expect(findCredentialBinding(bindings, 'c')).toBeUndefined();
  });
});

describe('optimistic selection', () => {
  const initial = [server('a', 'available', null), server('b', 'not_selected', 'select')];

  it('applies the change before the save finishes', async () => {
    let state = initial;
    let release!: () => void;
    const save = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const done = toggleServerSelection('b', true, {
      save,
      update: (updater) => {
        state = updater(state);
      },
    });
    expect(state.find((s) => s.name === 'b')?.selected).toBe(true);
    release();
    await expect(done).resolves.toBe(true);
    expect(save).toHaveBeenCalledWith('b', true);
    expect(state.find((s) => s.name === 'b')?.selected).toBe(true);
  });

  it('rolls back only the toggled row when saving fails', async () => {
    let state = initial;
    const result = await toggleServerSelection('a', false, {
      save: async () => {
        // Another row changes while the request is in flight.
        state = applySelection(state, 'b', true);
        throw new Error('boom');
      },
      update: (updater) => {
        state = updater(state);
      },
    });
    expect(result).toBe(false);
    expect(state.find((s) => s.name === 'a')?.selected).toBe(true);
    expect(state.find((s) => s.name === 'b')?.selected).toBe(true);
  });
});

describe('smart endpoint', () => {
  const aggregate = 'https://hub.example.com/alice/mcp';

  it('appends the smart routing segment to the personal endpoint', () => {
    expect(buildSmartEndpoint(aggregate)).toBe('https://hub.example.com/alice/mcp/$smart');
    expect(buildSmartEndpoint(`${aggregate}/`, 'smart')).toBe(
      'https://hub.example.com/alice/mcp/smart',
    );
  });
});

describe('latest-only loading', () => {
  const deferred = <T>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  };

  it('ignores a slow stale response that finishes after a newer one', async () => {
    const gate = createLatestOnly();
    const first = deferred<string>();
    const second = deferred<string>();
    const applied: string[] = [];
    const a = gate.run(
      () => first.promise,
      (value) => applied.push(value),
    );
    const b = gate.run(
      () => second.promise,
      (value) => applied.push(value),
    );
    second.resolve('new');
    await expect(b).resolves.toBe(true);
    first.resolve('stale');
    await expect(a).resolves.toBe(false);
    expect(applied).toEqual(['new']);
  });

  it('drops loads in flight when invalidated', async () => {
    const gate = createLatestOnly();
    const pending = deferred<string>();
    const applied: string[] = [];
    const run = gate.run(
      () => pending.promise,
      (value) => applied.push(value),
    );
    gate.invalidate();
    pending.resolve('stale');
    await run;
    expect(applied).toEqual([]);
  });

  it('skips focus refreshes while a selection save is in flight', () => {
    expect(shouldRefreshOnFocus(0)).toBe(true);
    expect(shouldRefreshOnFocus(1)).toBe(false);
  });
});

describe('authorization launch', () => {
  it('only accepts http(s) URLs', () => {
    expect(isHttpUrl('https://idp.example.com/authorize?x=1')).toBe(true);
    expect(isHttpUrl('http://localhost:3000/a')).toBe(true);
    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpUrl('data:text/html,hi')).toBe(false);
    expect(isHttpUrl('not a url')).toBe(false);
    expect(isHttpUrl(undefined)).toBe(false);
  });

  it('navigates the popup, falls back to a link when it was blocked, rejects bad URLs', () => {
    expect(resolveOAuthLaunch('https://idp.example.com/a', true)).toEqual({
      kind: 'navigate',
      url: 'https://idp.example.com/a',
    });
    expect(resolveOAuthLaunch('https://idp.example.com/a', false)).toEqual({
      kind: 'link',
      url: 'https://idp.example.com/a',
    });
    expect(resolveOAuthLaunch('javascript:alert(1)', true)).toEqual({ kind: 'invalid' });
    expect(resolveOAuthLaunch(undefined, true)).toEqual({ kind: 'none' });
  });
});

describe('workspace error handling helpers', () => {
  it('recognises the answer given once workspace mode is off', () => {
    expect(isWorkspaceDisabledMessage('Not found')).toBe(true);
    expect(isWorkspaceDisabledMessage('HTTP 404: Not Found')).toBe(true);
    expect(isWorkspaceDisabledMessage('Unable to list workspace servers')).toBe(false);
    expect(isWorkspaceDisabledMessage(undefined)).toBe(false);
  });

  it('treats a failed settings read as workspace mode off', () => {
    expect(resolveWorkspaceSetting({ success: false })).toEqual({
      enabled: false,
      failed: true,
      signedOut: false,
    });
    expect(resolveWorkspaceSetting(undefined)).toEqual({
      enabled: false,
      failed: true,
      signedOut: false,
    });
    expect(
      resolveWorkspaceSetting({
        success: true,
        data: { systemConfig: { workspace: { enabled: true } } },
      }),
    ).toEqual({ enabled: true, failed: false, signedOut: false });
    expect(resolveWorkspaceSetting({ success: true, data: { systemConfig: {} } })).toEqual({
      enabled: false,
      failed: false,
      signedOut: false,
    });
  });

  it('shows the maintenance end time localized instead of as an ISO instant', () => {
    const until = '2026-11-01T00:00:00.000Z';
    const text = localizeStatusMessage(
      { message: `'x' is under maintenance until ${until}. Try again later. Back soon.`, until },
      () => '1 Nov 2026',
    );
    expect(text).toBe("'x' is under maintenance until 1 Nov 2026. Try again later. Back soon.");
    expect(localizeStatusMessage({ message: 'plain' }, () => 'unused')).toBe('plain');
  });
});

describe('settings read after a known value', () => {
  it('keeps the last known workspace setting when a later read fails', () => {
    expect(resolveWorkspaceSetting({ success: false, status: 500 }, true)).toEqual({
      enabled: true,
      failed: true,
      signedOut: false,
    });
    expect(resolveWorkspaceSetting(undefined, false)).toEqual({
      enabled: false,
      failed: true,
      signedOut: false,
    });
  });

  it('reads a 401 as a signed-out session, not a failed read', () => {
    expect(resolveWorkspaceSetting({ success: false, status: 401 }, true)).toEqual({
      enabled: true,
      failed: false,
      signedOut: true,
    });
  });
});

describe('superseded runs', () => {
  it('does not surface the error of a run that was superseded', async () => {
    const gate = createLatestOnly();
    let fail!: (error: Error) => void;
    const slow = new Promise<string>((_, reject) => {
      fail = reject;
    });
    const stale = gate.run(
      () => slow,
      () => undefined,
    );
    await gate.run(
      async () => 'fresh',
      () => undefined,
    );
    fail(new Error('late failure'));
    await expect(stale).resolves.toBe(false);
  });

  it('still surfaces the error of the newest run', async () => {
    const gate = createLatestOnly();
    await expect(
      gate.run(
        async () => {
          throw new Error('boom');
        },
        () => undefined,
      ),
    ).rejects.toThrow('boom');
  });
});

describe('authorization links', () => {
  const needs = server('a', 'needs_auth', 'connect');
  it('keeps links only for servers that still need sign-in', () => {
    const links = { a: 'https://x/a', b: 'https://x/b' };
    expect(pruneAuthLinks(links, [needs, server('b', 'available', null)])).toEqual({
      a: 'https://x/a',
    });
    expect(pruneAuthLinks({ a: 'https://x/a' }, [needs])).toEqual({ a: 'https://x/a' });
  });
});

describe('resolveServiceChip', () => {
  const status = (code: string, action: string | null = null) =>
    ({ name: 'svc', status: { code, message: '', action } }) as never;
  const slots = new Set(['svc']);

  it('maps every status to exactly one chip and the action it needs', () => {
    expect(resolveServiceChip(status('available'), slots)).toEqual({ chip: 'ready', action: null });
    expect(resolveServiceChip(status('not_selected', 'select'), slots)).toEqual({
      chip: 'not_enabled',
      action: null,
    });
    expect(resolveServiceChip(status('needs_auth', 'connect'), slots)).toEqual({
      chip: 'needs_credentials',
      action: 'credentials',
    });
    expect(resolveServiceChip(status('needs_auth', 'connect'), new Set())).toEqual({
      chip: 'needs_signin',
      action: 'signin',
    });
    expect(resolveServiceChip(status('revoked', 'connect'), slots)).toEqual({
      chip: 'needs_signin',
      action: 'signin',
    });
    // Rejected is a wrong value; outdated is a service whose settings changed.
    expect(resolveServiceChip(status('credential_invalid', 'connect'), slots)).toEqual({
      chip: 'credentials_rejected',
      action: 'credentials',
    });
    expect(
      resolveServiceChip(status('credential_invalid', 'connect'), slots, { stale: true }),
    ).toEqual({ chip: 'credentials_outdated', action: 'credentials' });
    for (const code of ['paused', 'maintenance', 'error']) {
      expect(resolveServiceChip(status(code), slots)).toEqual({
        chip: 'unavailable',
        action: null,
      });
    }
  });

  it('lets the most important state win', () => {
    // Failing beats outdated credentials; outdated beats a plain ready.
    expect(resolveServiceChip(status('error'), slots, { stale: true }).chip).toBe('unavailable');
    expect(resolveServiceChip(status('available'), slots, { stale: true }).chip).toBe(
      'credentials_outdated',
    );
    // A service the user has not enabled is just not enabled, whatever its credentials.
    expect(resolveServiceChip(status('not_selected', 'select'), slots, { stale: true }).chip).toBe(
      'not_enabled',
    );
  });
});

describe('resolveServiceChip for services that sign in instead of taking credentials', () => {
  const status = (code: string, action: string | null = null) =>
    ({ name: 'canvas', status: { code, message: '', action } }) as never;
  const noSlots = new Set<string>();

  it('sends a rejected personal sign-in to a sign-in again, not to credentials', () => {
    expect(resolveServiceChip(status('credential_invalid', 'connect'), noSlots)).toEqual({
      chip: 'needs_signin',
      action: 'signin',
      reauth: true,
    });
  });

  it('shows a service the user may not use as contact-admin, with no action', () => {
    expect(resolveServiceChip(status('needs_auth', 'contact_admin'), noSlots)).toEqual({
      chip: 'contact_admin',
      action: null,
    });
    expect(
      resolveServiceChip(status('needs_auth', 'contact_admin'), new Set(['canvas'])).action,
    ).toBeNull();
  });

  it('knows the thresholds for the tool-count hint', () => {
    expect(toolCountLevel(40)).toBe('ok');
    expect(toolCountLevel(41)).toBe('warn');
    expect(toolCountLevel(81)).toBe('strong');
  });
});
