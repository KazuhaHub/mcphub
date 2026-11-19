/**
 * @jest-environment jsdom
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type {
  MyCredentialBinding,
  WorkspaceEndpoints,
  WorkspaceServer,
} from '../../frontend/src/types';
import CredentialDialog from '../../frontend/src/components/credentials/CredentialDialog';
import ConnectDialog from '../../frontend/src/components/connect/ConnectDialog';
import { resetWorkspaceStore } from '../../frontend/src/hooks/useWorkspaceData';
import CredentialsPage from '../../frontend/src/pages/CredentialsPage';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, string>) =>
      vars?.name
        ? `${key}:${vars.name}`
        : vars?.server
          ? `${key}:${vars.server}`
          : vars?.user
            ? `${key}:${vars.user}`
            : key,
  }),
}));
jest.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast: jest.fn() }) }));

const mockApiGet = jest.fn();
const mockApiPut = jest.fn();
jest.mock('@/utils/fetchInterceptor', () => ({
  apiGet: (url: string) => mockApiGet(url),
  apiPut: (url: string, body: unknown) => mockApiPut(url, body),
  apiPost: jest.fn(),
  apiDelete: jest.fn(),
}));
jest.mock('../../frontend/src/utils/fetchInterceptor', () => ({
  apiGet: (url: string) => mockApiGet(url),
  apiPut: (url: string, body: unknown) => mockApiPut(url, body),
  apiPost: jest.fn(),
  apiDelete: jest.fn(),
}));

let mockSearch = '';
const mockSetSearch = jest.fn();
jest.mock('react-router-dom', () => ({
  Navigate: ({ to }: { to: string }) => <div data-testid="navigate" data-to={to} />,
  useSearchParams: () => [new URLSearchParams(mockSearch), mockSetSearch],
}));
let mockAdmin = false;
let mockWorkspace = true;
let mockResolved = true;
jest.mock('../../frontend/src/contexts/AuthContext', () => ({
  useAuth: () => ({ auth: { user: { username: 'u', isAdmin: mockAdmin } } }),
}));
jest.mock('../../frontend/src/contexts/SettingsContext', () => ({
  useSettings: () => ({ workspaceEnabled: mockWorkspace, workspaceResolved: mockResolved }),
}));

const binding = (
  serverName: string,
  extra: Partial<MyCredentialBinding> = {},
): MyCredentialBinding => ({
  serverName,
  credentialTemplate: [{ target: 'env', name: 'API_KEY', label: 'API key' }],
  configured: false,
  configuredSlots: [],
  updatedAt: null,
  ...extra,
});

const bindings = [
  binding('anteater-personal', { manageUrl: 'https://anteater.example/keys' }),
  binding('ubc-personal', {
    stale: true,
    updatedAt: '2026-11-01T10:00:00.000Z',
    manageUrl: 'https://ubc.example/keys',
  }),
  binding('notes-personal', {
    configured: true,
    configuredSlots: ['env.API_KEY'],
    valuePreviews: { 'env.API_KEY': '••••1234' },
    updatedAt: '2026-11-02T10:00:00.000Z',
  }),
];

let mockServerList: WorkspaceServer[] = [];
let mockEndpointsData: WorkspaceEndpoints = { aggregate: '', servers: [] };
const ok = (data: unknown) => Promise.resolve({ success: true, data });

beforeEach(() => {
  mockApiGet.mockReset();
  mockApiPut.mockReset();
  mockSearch = '';
  mockSetSearch.mockReset();
  mockAdmin = false;
  mockWorkspace = true;
  mockResolved = true;
  mockServerList = [];
  mockEndpointsData = { aggregate: 'https://hub.example.com/alice/mcp', servers: [] };
  resetWorkspaceStore();
  mockApiGet.mockImplementation((url: string) => {
    if (url === '/credentials') return ok(bindings);
    if (url === '/workspace/servers') return ok(mockServerList);
    if (url === '/workspace/endpoints') return ok(mockEndpointsData);
    return ok([]);
  });
});

afterEach(() => resetWorkspaceStore());

describe('the credential panel', () => {
  it('shows only the selected service, with its fields, guidance link and env name', async () => {
    render(<CredentialDialog serverName="anteater-personal" onClose={jest.fn()} />);
    await screen.findByLabelText('anteater-personal');
    const dialog = screen.getByTestId('credential-dialog');
    expect(dialog.textContent).toContain('credentials.panelTitle:anteater-personal');
    expect(dialog.textContent).not.toContain('ubc-personal');
    expect(dialog.textContent).not.toContain('notes-personal');
    // Not bound yet: the form is open, with the label and the env name of the field.
    expect(dialog.textContent).toContain('API key');
    expect(dialog.textContent).toContain('env.API_KEY');
    expect(dialog.textContent).toContain('credentials.save');
    expect(dialog.textContent).toContain('credentials.copyFrom');
    expect(dialog.querySelector('a[href="/services/anteater-personal"]')).not.toBeNull();
    expect(dialog.querySelector('input[type="password"]')).not.toBeNull();
  });

  it('warns when the connection settings changed and shows the last update', async () => {
    render(<CredentialDialog serverName="ubc-personal" onClose={jest.fn()} />);
    await screen.findByLabelText('ubc-personal');
    const dialog = screen.getByTestId('credential-dialog');
    expect(screen.getByRole('status').textContent).toBe('credentials.staleNotice');
    expect(dialog.textContent).toContain('credentials.updatedAt');
    expect(dialog.textContent).toContain('credentials.replace');
  });

  it('keeps saved values masked and offers Replace for a bound service', async () => {
    render(<CredentialDialog serverName="notes-personal" onClose={jest.fn()} />);
    await screen.findByLabelText('notes-personal');
    const dialog = screen.getByTestId('credential-dialog');
    expect(dialog.textContent).toContain('••••1234');
    expect(dialog.querySelector('input[type="password"]')).toBeNull();
    fireEvent.click(screen.getByText('credentials.update'));
    expect(dialog.querySelector('input[type="password"]')).not.toBeNull();
    expect(dialog.textContent).toContain('credentials.replace');
  });

  it('saves through the credentials API for that one service and refreshes the shared data', async () => {
    mockApiPut.mockImplementation(() => ok({}));
    render(<CredentialDialog serverName="anteater-personal" onClose={jest.fn()} />);
    await screen.findByLabelText('anteater-personal');
    const refetchesBefore = mockApiGet.mock.calls.filter(
      (c) => c[0] === '/workspace/servers',
    ).length;
    fireEvent.change(document.querySelector('input[type="password"]') as HTMLInputElement, {
      target: { value: 'secret-value' },
    });
    await act(async () => {
      fireEvent.click(screen.getByText('credentials.save'));
    });
    await waitFor(() =>
      expect(
        mockApiGet.mock.calls.filter((c) => c[0] === '/workspace/servers').length,
      ).toBeGreaterThan(refetchesBefore),
    );
    expect(mockApiPut).toHaveBeenCalledWith('/credentials/anteater-personal', {
      values: { 'env.API_KEY': 'secret-value' },
    });
  });

  it('closes with Escape', async () => {
    const onClose = jest.fn();
    render(<CredentialDialog serverName="anteater-personal" onClose={onClose} />);
    await screen.findByLabelText('anteater-personal');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});

const needsAuth = (name: string, extra: Partial<WorkspaceServer> = {}) =>
  ({
    name,
    selected: true,
    enabled: true,
    toolCount: null,
    status: { code: 'needs_auth', message: 'backend words', action: 'connect' },
    ...extra,
  }) as WorkspaceServer;

const endpointsFor = (...names: string[]): WorkspaceEndpoints => ({
  aggregate: 'https://hub.example.com/alice/mcp',
  servers: names.map((name) => ({ name, url: `https://hub.example.com/alice/mcp/${name}` })),
});

const renderConnect = async (
  servers: WorkspaceServer[],
  initial: React.ComponentProps<typeof ConnectDialog>['initial'],
  onClose = jest.fn(),
) => {
  mockServerList = servers;
  mockEndpointsData = endpointsFor(...servers.map((server) => server.name));
  render(
    <ConnectDialog
      aggregateUrl={mockEndpointsData.aggregate}
      initial={initial}
      onClose={onClose}
    />,
  );
  await screen.findByRole('alert');
  return onClose;
};

describe('the Connect to AI prompt for missing credentials', () => {
  it('opens the credential panel for that service instead of navigating', async () => {
    await renderConnect([needsAuth('anteater-personal')], {
      service: 'anteater-personal',
      client: 'claude',
    });
    expect(screen.queryByTestId('credential-dialog')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain(
      'workspacePage.panel.statusText.needs_credentials',
    );
    fireEvent.click(screen.getByText('workspacePage.chip.action.credentials'));
    const panel = await screen.findByTestId('credential-dialog');
    expect(panel.textContent).toContain('credentials.panelTitle:anteater-personal');
    await screen.findByLabelText('anteater-personal');
    expect(panel.textContent).not.toContain('ubc-personal');
  });

  it('shows the same state and action as the list for outdated and rejected credentials', async () => {
    await renderConnect([needsAuth('ubc-personal')], { service: 'ubc-personal', client: 'claude' });
    // The binding is outdated (stale): the same chip, text and Update button as on the list.
    expect(screen.getByRole('alert').textContent).toContain(
      'workspacePage.panel.statusText.credentials_outdated',
    );
    expect(screen.getByText('workspacePage.chip.action.update')).toBeTruthy();
  });
});

describe('the Connect to AI prompt for a service without credential slots', () => {
  it('offers to sign in, not to add credentials', async () => {
    await renderConnect([needsAuth('canvas-portal', { hasCredentialSlots: false })], {
      service: 'canvas-portal',
      client: 'claude',
    });
    expect(screen.getByRole('alert').textContent).toContain(
      'workspacePage.panel.statusText.needs_signin',
    );
    expect(screen.getByText('workspacePage.chip.action.signin')).toBeTruthy();
    expect(screen.queryByText('workspacePage.chip.action.credentials')).toBeNull();
  });

  it('offers sign in again for a rejected sign-in', async () => {
    await renderConnect(
      [
        needsAuth('canvas-portal', {
          hasCredentialSlots: false,
          status: { code: 'credential_invalid', message: 'x', action: 'connect' },
        }),
      ],
      { service: 'canvas-portal', client: 'claude' },
    );
    expect(screen.getByRole('alert').textContent).toContain(
      'workspacePage.panel.statusText.signin_again',
    );
    expect(screen.getByText('workspacePage.chip.action.signinAgain')).toBeTruthy();
  });

  it('only explains, with no button, when the user may not use the service', async () => {
    await renderConnect(
      [
        needsAuth('locked', {
          status: { code: 'needs_auth', message: 'backend words', action: 'contact_admin' },
        }),
      ],
      { service: 'locked', client: 'claude' },
    );
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe('workspacePage.panel.statusText.contact_admin');
    expect(alert.querySelector('button, a')).toBeNull();
  });
});

describe('stacked layers', () => {
  const open = () =>
    renderConnect([needsAuth('anteater-personal')], {
      service: 'anteater-personal',
      client: 'claude',
    });

  it('closes only the top layer on Escape, traps Tab, and locks and restores page scroll', async () => {
    document.body.style.overflow = '';
    const onClose = await open();
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.click(screen.getByText('workspacePage.chip.action.credentials'));
    await screen.findByTestId('credential-dialog');
    fireEvent.keyDown(document, { key: 'Escape' });
    // The credential dialog is on top; the connect dialog behind it ignores that Escape.
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByTestId('credential-dialog')).toBeNull());
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    // Tab wraps inside the dialog.
    const dialog = screen.getByTestId('connect-dialog');
    const focusable = dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled])');
    const last = focusable[focusable.length - 1];
    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(focusable[0]);
  });

  it('puts focus back on the dialog underneath when the opener is gone after a save', async () => {
    mockApiPut.mockImplementation(() => ok({}));
    await open();
    const opener = screen.getByText('workspacePage.chip.action.credentials');
    fireEvent.click(opener);
    await screen.findByTestId('credential-dialog');
    // The opener disappears (as it does once the service no longer needs credentials).
    opener.remove();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('credential-dialog')).toBeNull());
    expect(screen.getByTestId('connect-dialog').contains(document.activeElement)).toBe(true);
  });
});

describe('the /credentials route', () => {
  const page = () => render(<CredentialsPage />);

  it('sends an ordinary user to the services list', () => {
    page();
    expect(screen.getByTestId('navigate').getAttribute('data-to')).toBe('/workspace/services');
  });

  it('keeps old per-service links working by opening that service in the workspace', () => {
    mockSearch = 'server=my%20server';
    page();
    expect(screen.getByTestId('navigate').getAttribute('data-to')).toBe(
      '/workspace/services/my%20server?tab=credentials',
    );
  });

  it('keeps the old page for ordinary users while Workspace Mode is off', async () => {
    mockWorkspace = false;
    page();
    expect(screen.queryByTestId('navigate')).toBeNull();
    await screen.findByText('credentials.title');
  });

  it('keeps the administrator page for managing other users', async () => {
    mockAdmin = true;
    mockApiGet.mockImplementation((url: string) =>
      ok(url === '/users' ? [{ username: 'alice' }, { username: 'bob' }] : bindings),
    );
    page();
    expect(screen.queryByTestId('navigate')).toBeNull();
    await screen.findByText('credentials.adminTitle');
    await screen.findByText('alice');
    expect(screen.getByText('credentials.chooseUser')).toBeTruthy();
    // No list of the administrator's own services here.
    expect(screen.queryByLabelText('anteater-personal')).toBeNull();
  });

  it('shows the chosen user’s credentials on the administrator page', async () => {
    mockAdmin = true;
    mockSearch = 'user=alice';
    mockApiGet.mockImplementation((url: string) =>
      ok(url === '/users' ? [{ username: 'alice' }] : bindings),
    );
    page();
    await screen.findByLabelText('anteater-personal');
    expect(mockApiGet).toHaveBeenCalledWith('/users/alice/credentials');
  });
});

describe('the /credentials route while the workspace setting is unknown', () => {
  it('shows nothing of the old page and fetches nothing until it is known', async () => {
    mockResolved = false;
    mockWorkspace = false;
    render(<CredentialsPage />);
    expect(screen.getByRole('status').textContent).toBe('credentials.loading');
    expect(screen.queryByTestId('navigate')).toBeNull();
    await act(async () => {});
    expect(mockApiGet).not.toHaveBeenCalled();
  });

  it('does not list users for an administrator before it is known', async () => {
    mockResolved = false;
    mockAdmin = true;
    render(<CredentialsPage />);
    await act(async () => {});
    expect(mockApiGet).not.toHaveBeenCalled();
  });
});

describe('the administrator credentials page', () => {
  beforeEach(() => {
    mockAdmin = true;
    mockApiGet.mockImplementation((url: string) =>
      ok(url === '/users' ? [{ username: 'alice' }] : bindings),
    );
  });

  it('clears ?server= together with the user when "choose a user" is picked', async () => {
    mockSearch = 'user=alice&server=anteater-personal';
    render(<CredentialsPage />);
    await screen.findByText('alice', { selector: 'option' });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } });
    const update = mockSetSearch.mock.calls[0][0] as (p: URLSearchParams) => URLSearchParams;
    const params = update(new URLSearchParams(mockSearch));
    expect(params.has('user')).toBe(false);
    expect(params.has('server')).toBe(false);
  });

  it('always says whose credentials are shown', async () => {
    mockSearch = 'user=alice';
    render(<CredentialsPage />);
    await screen.findByLabelText('anteater-personal');
    expect(screen.getByTestId('credentials-subject').textContent).toBe(
      'credentials.showingFor:alice',
    );
  });
});
