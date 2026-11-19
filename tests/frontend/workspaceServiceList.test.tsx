/**
 * @jest-environment jsdom
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type {
  MyCredentialBinding,
  WorkspaceEndpoints,
  WorkspaceServer,
} from '../../frontend/src/types';
import WorkspaceServicesView from '../../frontend/src/components/workspace/WorkspaceServicesView';
import {
  notifyWorkspaceChanged,
  onWorkspaceChanged,
} from '../../frontend/src/utils/workspaceEvents';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars?.name ? `${key}:${vars.name}` : vars && 'count' in vars ? `${key}:${vars.count}` : key,
  }),
}));
const mockToast = jest.fn();
jest.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast: mockToast }) }));

let mockSearch = new URLSearchParams();
const mockSetSearch = jest.fn();
jest.mock('react-router-dom', () => ({
  useSearchParams: () => [mockSearch, mockSetSearch],
}));

jest.mock('@/components/connect/ConnectDialog', () => ({
  __esModule: true,
  default: ({ initial, onClose }: { initial: { service: string }; onClose: () => void }) => (
    <div data-testid="connect-dialog-stub" data-service={initial.service}>
      <button type="button" onClick={onClose}>
        close-connect
      </button>
    </div>
  ),
}));

const mockServers = jest.fn();
const mockBindings = jest.fn();
const mockSave = jest.fn();
const mockRisk = jest.fn();
jest.mock('@/services/workspaceService', () => ({
  fetchWorkspaceServers: () => mockServers(),
  fetchWorkspaceEndpoints: () => Promise.resolve(endpoints),
  fetchCredentialBindings: () => mockBindings(),
  saveServerSelection: (...args: unknown[]) => mockSave(...args),
  saveRiskCeiling: (...args: unknown[]) => mockRisk(...args),
  launchPersonalOAuth: jest.fn(() => Promise.resolve({ kind: 'started' })),
}));
jest.mock('@/utils/fetchInterceptor', () => ({
  apiGet: jest.fn(() => Promise.resolve({ success: true, data: [] })),
  apiPut: jest.fn(() => Promise.resolve({ success: true, data: {} })),
  apiPost: jest.fn(),
  apiDelete: jest.fn(),
}));

const endpoints: WorkspaceEndpoints = {
  aggregate: 'https://hub.example.com/u/mcp',
  servers: ['anteater-shared', 'canvas-portal'].map((name) => ({
    name,
    url: `https://hub.example.com/u/mcp/${name}`,
  })),
};

const base = {
  selected: true,
  enabled: true,
  riskCeiling: 'read',
  riskCeilingIsDefault: false,
  annotationsTrusted: true,
  maxAllowedRisk: 'external',
  requiresPersonalCredential: false,
  credentialConfigured: false,
  manageUrl: undefined,
};
const DESCRIPTION = 'Anteater MCP 1.0.0-beta.3 | source e48eba0 | Node 24.21.0. Internal build.';
const servers = [
  {
    ...base,
    name: 'anteater-shared',
    description: DESCRIPTION,
    toolCount: 20,
    riskCounts: { read: 12, write: 6, external: 2 },
    manageUrl: 'https://anteater.example/account',
    status: { code: 'available', message: '', action: null },
  },
  {
    ...base,
    name: 'anteater-personal',
    selected: false,
    toolCount: null,
    riskCounts: null,
    requiresPersonalCredential: true,
    status: { code: 'not_selected', message: '', action: 'select' },
  },
  {
    ...base,
    name: 'ubc-personal',
    toolCount: null,
    riskCounts: null,
    requiresPersonalCredential: true,
    status: { code: 'credential_invalid', message: 'Credentials rejected', action: 'connect' },
  },
  {
    ...base,
    name: 'needs-keys',
    toolCount: null,
    riskCounts: null,
    requiresPersonalCredential: true,
    status: { code: 'needs_auth', message: '', action: 'connect' },
  },
  {
    ...base,
    name: 'canvas-portal',
    description: 'Canvas LMS bridge.',
    toolCount: null,
    riskCounts: null,
    status: { code: 'needs_auth', message: '', action: 'connect' },
  },
  {
    ...base,
    name: 'oauth-rejected',
    description: 'Personal Canvas sign-in.',
    toolCount: null,
    riskCounts: null,
    requiresPersonalCredential: true,
    status: { code: 'credential_invalid', message: 'Token rejected', action: 'connect' },
  },
  {
    ...base,
    name: 'no-access',
    toolCount: null,
    riskCounts: null,
    status: { code: 'needs_auth', message: 'Not available', action: 'contact_admin' },
  },
  {
    ...base,
    name: 'broken',
    toolCount: 3,
    riskCounts: { read: 3, write: 0, external: 0 },
    status: { code: 'error', message: 'Connection refused', action: 'retry_later' },
  },
] as unknown as WorkspaceServer[];

const binding = (serverName: string, extra: Partial<MyCredentialBinding> = {}) => ({
  serverName,
  credentialTemplate: [{ target: 'env', name: 'API_KEY', label: 'API key' }],
  configured: false,
  configuredSlots: [],
  updatedAt: null,
  ...extra,
});
const bindings = [
  binding('anteater-personal'),
  binding('ubc-personal', { stale: true, updatedAt: '2026-11-01T10:00:00.000Z' }),
  binding('needs-keys'),
];

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const row = (name: string) => screen.getByTestId(`workspace-service-${name}`);
const mount = async () => {
  render(<WorkspaceServicesView />);
  await screen.findByTestId('workspace-service-anteater-shared');
  await waitFor(() => expect(mockBindings).toHaveBeenCalled());
  await act(async () => {});
};

beforeEach(() => {
  mockSearch = new URLSearchParams();
  mockSetSearch.mockReset();
  mockToast.mockReset();
  mockSave.mockReset().mockResolvedValue(undefined);
  mockRisk.mockReset().mockResolvedValue(undefined);
  mockServers.mockReset().mockImplementation(() => Promise.resolve(clone(servers)));
  mockBindings.mockReset().mockImplementation(() => Promise.resolve(clone(bindings)));
  document.body.style.overflow = '';
});

describe('a row of the available services list', () => {
  it('holds only the switch, the name, one status, at most one action and a chevron', async () => {
    await mount();
    for (const { name } of servers) {
      const li = row(name);
      expect(li.querySelectorAll('[role="switch"]')).toHaveLength(1);
      expect(li.textContent).toContain(name);
      expect(li.querySelectorAll('[data-chip]')).toHaveLength(1);
      // switch + open button + at most one action button
      expect(li.querySelectorAll('button').length).toBeLessThanOrEqual(3);
      expect(li.querySelectorAll('[data-testid^="workspace-action-"]').length).toBeLessThanOrEqual(
        1,
      );
      expect(li.querySelector('[role="radio"], [role="radiogroup"], a, input')).toBeNull();
      expect(li.querySelector('svg')).not.toBeNull();
      const text = li.textContent ?? '';
      expect(text).not.toContain('Anteater MCP');
      expect(text).not.toContain('Canvas LMS');
      for (const gone of [
        'toolCount',
        'risk.',
        'actions.select',
        'connect.rowAction',
        'manageAccount',
        'copyEndpoint',
        'credentialBadge',
        'defaultNote',
      ]) {
        expect(text).not.toContain(gone);
      }
    }
  });

  it('shows one status per row with the most important state winning', async () => {
    await mount();
    const chip = (name: string) =>
      row(name).querySelector('[data-chip]')!.getAttribute('data-chip');
    expect(chip('anteater-shared')).toBe('ready');
    expect(chip('anteater-personal')).toBe('not_enabled');
    expect(chip('ubc-personal')).toBe('credentials_outdated');
    expect(chip('needs-keys')).toBe('needs_credentials');
    expect(chip('canvas-portal')).toBe('needs_signin');
    expect(chip('broken')).toBe('unavailable');
    expect(row('broken').textContent).not.toContain('Connection refused');
  });

  it('offers a button only when the user must act, labelled for what it does', async () => {
    await mount();
    const action = (name: string) =>
      row(name).querySelector('[data-testid^="workspace-action-"]') as HTMLElement | null;
    expect(action('anteater-shared')).toBeNull();
    expect(action('anteater-personal')).toBeNull();
    expect(action('broken')).toBeNull();
    expect(action('canvas-portal')!.textContent).toBe('workspacePage.chip.action.signin');
    expect(action('needs-keys')!.textContent).toBe('workspacePage.chip.action.credentials');
    expect(action('ubc-personal')!.textContent).toBe('workspacePage.chip.action.update');
  });

  it('opens the service panel on a click anywhere on the row', async () => {
    await mount();
    expect(screen.queryByTestId('service-panel')).toBeNull();
    fireEvent.click(row('anteater-shared'));
    expect(screen.getByTestId('service-panel').getAttribute('data-service')).toBe(
      'anteater-shared',
    );
  });

  it('is reachable and opened from the keyboard: a native button, closed with Escape, focus back', async () => {
    await mount();
    const opener = screen.getByTestId('workspace-open-ubc-personal');
    expect(opener.tagName).toBe('BUTTON');
    expect(opener.getAttribute('aria-haspopup')).toBe('dialog');
    opener.focus();
    // Enter and Space on a button are delivered as a click.
    fireEvent.click(opener);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('service-panel')).toBeNull());
    expect(document.activeElement).toBe(opener);
    expect(document.body.style.overflow).toBe('');
  });

  it('does not open the panel from the switch, and still toggles the service', async () => {
    await mount();
    fireEvent.click(within(row('anteater-personal')).getByRole('switch'));
    expect(screen.queryByTestId('service-panel')).toBeNull();
    await waitFor(() => expect(mockSave).toHaveBeenCalledWith('anteater-personal', true));
  });

  it('does not open the panel from the action button; sign in starts the flow', async () => {
    await mount();
    const { launchPersonalOAuth } = jest.requireMock('@/services/workspaceService');
    fireEvent.click(screen.getByTestId('workspace-action-canvas-portal'));
    expect(screen.queryByTestId('service-panel')).toBeNull();
    await waitFor(() => expect(launchPersonalOAuth).toHaveBeenCalledWith('canvas-portal'));
  });

  it('opens the panel at the credentials section from a credentials action', async () => {
    await mount();
    fireEvent.click(screen.getByTestId('workspace-action-needs-keys'));
    const panel = await screen.findByTestId('service-panel');
    const heading = within(panel).getByText('workspacePage.panel.credentials');
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });

  it('keeps one short explanation at the top of the list, not on rows', async () => {
    await mount();
    expect(screen.getByText('workspacePage.services.description')).toBeTruthy();
  });
});

describe('the service panel', () => {
  it('lists description, status, tools, permissions and actions in order for a ready service', async () => {
    await mount();
    fireEvent.click(row('anteater-shared'));
    const panel = screen.getByTestId('service-panel');
    expect(screen.getByTestId('service-panel-description').textContent).toBe(DESCRIPTION);
    const order = [
      'service-panel-description',
      'service-panel-status',
      'service-panel-tools',
      'service-panel-permissions',
      'service-panel-actions',
    ].map((id) => panel.querySelector(`[data-testid="${id}"]`)!);
    order.forEach((el) => expect(el).not.toBeNull());
    for (let i = 1; i < order.length; i += 1) {
      expect(
        order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    }
    expect(panel.querySelector('[data-testid="service-panel-credentials"]')).toBeNull();
    expect(within(panel).getByText('workspacePage.services.toolCount:20')).toBeTruthy();
    expect(within(panel).getAllByRole('radio')).toHaveLength(3);
    // The explanation is shown once.
    expect(panel.textContent!.split('workspacePage.risk.explanation')).toHaveLength(2);
    expect(within(panel).getByText('connect.rowAction')).toBeTruthy();
    expect(
      within(panel).getByLabelText('workspacePage.services.copyEndpointFor:anteater-shared'),
    ).toBeTruthy();
    expect(panel.querySelector('a[href="/services/anteater-shared"]')).not.toBeNull();
  });

  it('saves the permission level through the existing call', async () => {
    await mount();
    fireEvent.click(row('anteater-shared'));
    const panel = screen.getByTestId('service-panel');
    fireEvent.click(panel.querySelector('[data-risk-level="write"]')!);
    await waitFor(() => expect(mockRisk).toHaveBeenCalledWith('anteater-shared', 'write'));
  });

  it('says tools are visible after sign-in, and puts the sign-in next to the status', async () => {
    await mount();
    fireEvent.click(row('canvas-portal'));
    const panel = screen.getByTestId('service-panel');
    expect(within(panel).getByText('workspacePage.panel.toolsAfterSignIn')).toBeTruthy();
    expect(within(panel).getByText('workspacePage.panel.statusText.needs_signin')).toBeTruthy();
    expect(within(panel).getByTestId('service-panel-action').textContent).toBe(
      'workspacePage.chip.action.signinTo:canvas-portal',
    );
    expect(panel.querySelector('[data-testid="service-panel-credentials"]')).toBeNull();
  });

  it('shows the credentials form inline, for that service only, and the error details', async () => {
    await mount();
    fireEvent.click(row('ubc-personal'));
    const panel = screen.getByTestId('service-panel');
    expect(panel.querySelector('[data-testid="service-panel-credentials"]')).not.toBeNull();
    await within(panel).findByLabelText('ubc-personal');
    expect(panel.textContent).not.toContain('anteater-personal');
    expect(panel.textContent).toContain('Credentials rejected');
    expect(screen.queryByTestId('credential-dialog')).toBeNull();
  });

  it('shows the failure message of an unavailable service only in the panel', async () => {
    await mount();
    fireEvent.click(row('broken'));
    expect(
      within(screen.getByTestId('service-panel')).getByText('Connection refused'),
    ).toBeTruthy();
  });

  it('opens Connect to AI scoped to this service, above the panel', async () => {
    await mount();
    fireEvent.click(row('anteater-shared'));
    fireEvent.click(
      within(screen.getByTestId('service-panel')).getByLabelText(
        'connect.rowActionFor:anteater-shared',
      ),
    );
    expect(screen.getByTestId('connect-dialog-stub').getAttribute('data-service')).toBe(
      'anteater-shared',
    );
  });

  it('closes from the close button', async () => {
    await mount();
    fireEvent.click(row('anteater-shared'));
    fireEvent.click(within(screen.getByTestId('service-panel')).getByLabelText('app.closeButton'));
    expect(screen.queryByTestId('service-panel')).toBeNull();
  });
});

describe('deep links', () => {
  it('opens the panel for ?service= and clears the parameter', async () => {
    mockSearch = new URLSearchParams('service=canvas-portal');
    render(<WorkspaceServicesView />);
    const panel = await screen.findByTestId('service-panel');
    expect(panel.getAttribute('data-service')).toBe('canvas-portal');
    expect(mockSetSearch).toHaveBeenCalled();
    const update = mockSetSearch.mock.calls[0][0] as (p: URLSearchParams) => URLSearchParams;
    expect(update(new URLSearchParams('service=canvas-portal')).has('service')).toBe(false);
  });

  it('opens the panel for ?credentials= with the credentials section focused', async () => {
    mockSearch = new URLSearchParams('credentials=anteater-personal');
    render(<WorkspaceServicesView />);
    const panel = await screen.findByTestId('service-panel');
    expect(panel.getAttribute('data-service')).toBe('anteater-personal');
    const heading = within(panel).getByText('workspacePage.panel.credentials');
    await waitFor(() => expect(document.activeElement).toBe(heading));
    await within(panel).findByLabelText('anteater-personal');
  });

  it('opens nothing for a service the user does not have', async () => {
    mockSearch = new URLSearchParams('service=nope');
    render(<WorkspaceServicesView />);
    await screen.findByTestId('workspace-service-anteater-shared');
    await act(async () => {});
    expect(screen.queryByTestId('service-panel')).toBeNull();
  });
});

describe('one source of truth after credential changes', () => {
  it('refetches the servers and the bindings when any entry point reports a change', async () => {
    await mount();
    const serversBefore = mockServers.mock.calls.length;
    const bindingsBefore = mockBindings.mock.calls.length;
    await act(async () => {
      notifyWorkspaceChanged();
    });
    await waitFor(() => expect(mockServers.mock.calls.length).toBeGreaterThan(serversBefore));
    expect(mockBindings.mock.calls.length).toBeGreaterThan(bindingsBefore);
  });

  it('refetches the bindings too when the window regains focus', async () => {
    await mount();
    const before = mockBindings.mock.calls.length;
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => expect(mockBindings.mock.calls.length).toBeGreaterThan(before));
  });

  it('shows the new status after a save made in the panel', async () => {
    await mount();
    fireEvent.click(row('needs-keys'));
    const panel = screen.getByTestId('service-panel');
    await within(panel).findByLabelText('needs-keys');
    // The server now reports the service ready and the binding configured.
    mockServers.mockImplementation(() =>
      Promise.resolve(
        clone(servers).map((s) =>
          s.name === 'needs-keys'
            ? { ...s, status: { code: 'available', message: '', action: null } }
            : s,
        ),
      ),
    );
    await act(async () => {
      notifyWorkspaceChanged();
    });
    await waitFor(() =>
      expect(row('needs-keys').querySelector('[data-chip]')!.getAttribute('data-chip')).toBe(
        'ready',
      ),
    );
  });
});

describe('the top of the services list', () => {
  it('has no summary banner or tool-count card, only a muted hidden-tools note', async () => {
    await mount();
    expect(document.querySelector('[data-banner]')).toBeNull();
    expect(document.querySelector('[data-level]')).toBeNull();
    // anteater-shared: 6 + 2 tools above the read-only default.
    expect(screen.getByTestId('hidden-tools-note').textContent).toBe(
      'workspacePage.risk.hiddenSummary:8',
    );
  });

  it('shows no note when nothing is hidden', async () => {
    mockServers.mockImplementation(() =>
      Promise.resolve(clone(servers).map((s) => ({ ...s, riskCeiling: 'external' }))),
    );
    await mount();
    expect(screen.queryByTestId('hidden-tools-note')).toBeNull();
  });
});

describe('services that sign in rather than take credentials', () => {
  it('shows a rejected sign-in as sign in again, with no credentials section', async () => {
    await mount();
    const li = row('oauth-rejected');
    expect(li.querySelector('[data-chip]')!.getAttribute('data-chip')).toBe('needs_signin');
    expect(screen.getByTestId('workspace-action-oauth-rejected').textContent).toBe(
      'workspacePage.chip.action.signinAgain',
    );
    fireEvent.click(li);
    const panel = screen.getByTestId('service-panel');
    expect(panel.querySelector('[data-testid="service-panel-credentials"]')).toBeNull();
    expect(within(panel).getByText('workspacePage.panel.statusText.signin_again')).toBeTruthy();
    const { launchPersonalOAuth } = jest.requireMock('@/services/workspaceService');
    fireEvent.click(within(panel).getByTestId('service-panel-action'));
    await waitFor(() => expect(launchPersonalOAuth).toHaveBeenCalledWith('oauth-rejected'));
  });

  it('shows no credentials section for a service without credential slots', async () => {
    await mount();
    fireEvent.click(row('anteater-shared'));
    expect(
      screen
        .getByTestId('service-panel')
        .querySelector('[data-testid="service-panel-credentials"]'),
    ).toBeNull();
  });

  it('shows a rejected credential as rejected, not outdated', async () => {
    mockBindings.mockImplementation(() =>
      Promise.resolve([...clone(bindings), binding('oauth-rejected')]),
    );
    await mount();
    expect(row('oauth-rejected').querySelector('[data-chip]')!.getAttribute('data-chip')).toBe(
      'credentials_rejected',
    );
  });
});

describe('a service the user may not use', () => {
  it('says so and offers no action; the panel tells them to contact the administrator', async () => {
    await mount();
    const li = row('no-access');
    expect(li.querySelector('[data-chip]')!.getAttribute('data-chip')).toBe('contact_admin');
    expect(li.querySelector('[data-testid^="workspace-action-"]')).toBeNull();
    fireEvent.click(li);
    const panel = screen.getByTestId('service-panel');
    expect(within(panel).getByText('workspacePage.panel.statusText.contact_admin')).toBeTruthy();
    expect(within(panel).queryByTestId('service-panel-action')).toBeNull();
  });
});

describe('a blocked sign-in popup', () => {
  it('opens the panel from the row so the link is visible', async () => {
    const { launchPersonalOAuth } = jest.requireMock('@/services/workspaceService');
    launchPersonalOAuth.mockResolvedValueOnce({ kind: 'link', url: 'https://idp.example/auth' });
    await mount();
    fireEvent.click(screen.getByTestId('workspace-action-canvas-portal'));
    const panel = await screen.findByTestId('service-panel');
    const link = within(panel).getByText('workspacePage.actions.openAuthorization');
    expect(link.getAttribute('href')).toBe('https://idp.example/auth');
  });
});

describe('the hint under the subtitle for many tools', () => {
  const many = (count: number) =>
    mockServers.mockImplementation(() =>
      Promise.resolve(
        clone(servers).map((s) => (s.name === 'anteater-shared' ? { ...s, toolCount: count } : s)),
      ),
    );

  it('appears above 40 tools and again, stronger, above 80', async () => {
    many(41);
    await mount();
    expect(screen.getByTestId('tools-hint').getAttribute('data-level')).toBe('warn');
    expect(screen.getByTestId('tools-hint').textContent).toBe('workspacePage.toolsHint.warn:41');
  });

  it('is the strong sentence above 80', async () => {
    many(81);
    await mount();
    expect(screen.getByTestId('tools-hint').getAttribute('data-level')).toBe('strong');
  });

  it('is absent at or below 40 tools', async () => {
    many(40);
    await mount();
    expect(screen.queryByTestId('tools-hint')).toBeNull();
  });
});

describe('changes made on the list reach the rest of the page', () => {
  it('announces a toggle to other listeners, but does not reload twice for its own', async () => {
    await mount();
    const heard = jest.fn();
    const off = onWorkspaceChanged(heard);
    const before = mockServers.mock.calls.length;
    fireEvent.click(within(row('anteater-personal')).getByRole('switch'));
    await waitFor(() => expect(heard).toHaveBeenCalled());
    await act(async () => {});
    // One refetch after the save; the list ignores its own announcement.
    expect(mockServers.mock.calls.length - before).toBe(1);
    off();
  });
});
