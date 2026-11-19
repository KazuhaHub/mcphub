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
import { onWorkspaceChanged } from '../../frontend/src/utils/workspaceEvents';
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

const ok = (data: unknown) => Promise.resolve({ success: true, data });

beforeEach(() => {
  mockApiGet.mockReset();
  mockApiPut.mockReset();
  mockSearch = '';
  mockSetSearch.mockReset();
  mockAdmin = false;
  mockWorkspace = true;
  mockResolved = true;
  mockApiGet.mockImplementation((url: string) => (url === '/credentials' ? ok(bindings) : ok([])));
});

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

  it('saves through the credentials API for that one service and reports the change', async () => {
    mockApiPut.mockImplementation(() => ok({}));
    const onChanged = jest.fn();
    render(
      <CredentialDialog serverName="anteater-personal" onChanged={onChanged} onClose={jest.fn()} />,
    );
    await screen.findByLabelText('anteater-personal');
    fireEvent.change(document.querySelector('input[type="password"]') as HTMLInputElement, {
      target: { value: 'secret-value' },
    });
    await act(async () => {
      fireEvent.click(screen.getByText('credentials.save'));
    });
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
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

describe('the Connect to AI prompt for missing credentials', () => {
  const endpoints: WorkspaceEndpoints = {
    aggregate: 'https://hub.example.com/alice/mcp',
    servers: [
      { name: 'anteater-personal', url: 'https://hub.example.com/alice/mcp/anteater-personal' },
    ],
  };
  const needsAuth = {
    name: 'anteater-personal',
    selected: true,
    enabled: true,
    toolCount: null,
    status: { code: 'needs_auth', message: '', action: 'connect' },
  } as WorkspaceServer;

  it('opens the credential panel for that service instead of navigating', async () => {
    render(
      <ConnectDialog
        aggregateUrl={endpoints.aggregate}
        servers={[needsAuth]}
        endpoints={endpoints}
        initial={{ service: 'anteater-personal', client: 'claude' }}
        onClose={jest.fn()}
      />,
    );
    expect(screen.queryByTestId('credential-dialog')).toBeNull();
    fireEvent.click(screen.getByText('connect.bindCredentials'));
    const panel = await screen.findByTestId('credential-dialog');
    expect(panel.textContent).toContain('credentials.panelTitle:anteater-personal');
    await screen.findByLabelText('anteater-personal');
    expect(panel.textContent).not.toContain('ubc-personal');
  });
});

describe('the /credentials route', () => {
  const page = () => render(<CredentialsPage />);

  it('sends an ordinary user to the workspace', () => {
    page();
    expect(screen.getByTestId('navigate').getAttribute('data-to')).toBe('/workspace');
  });

  it('keeps old per-service links working by opening that service in the workspace', () => {
    mockSearch = 'server=my%20server';
    page();
    expect(screen.getByTestId('navigate').getAttribute('data-to')).toBe(
      '/workspace?credentials=my%20server',
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

describe('the Connect to AI prompt for a service without credential slots', () => {
  const endpoints: WorkspaceEndpoints = {
    aggregate: 'https://hub.example.com/alice/mcp',
    servers: [{ name: 'canvas-portal', url: 'https://hub.example.com/alice/mcp/canvas-portal' }],
  };
  const needsSignIn = {
    name: 'canvas-portal',
    selected: true,
    enabled: true,
    toolCount: null,
    status: { code: 'needs_auth', message: '', action: 'connect' },
  } as WorkspaceServer;

  it('offers to sign in, not to add credentials', async () => {
    render(
      <ConnectDialog
        aggregateUrl={endpoints.aggregate}
        servers={[needsSignIn]}
        endpoints={endpoints}
        initial={{ service: 'canvas-portal', client: 'claude' }}
        onClose={jest.fn()}
      />,
    );
    await screen.findByText('workspacePage.chip.action.signin');
    expect(screen.getByRole('alert').textContent).toContain('connect.needsSignIn:canvas-portal');
    expect(screen.queryByText('connect.bindCredentials')).toBeNull();
  });
});

describe('stacked layers', () => {
  const endpoints: WorkspaceEndpoints = {
    aggregate: 'https://hub.example.com/alice/mcp',
    servers: [{ name: 'anteater-personal', url: 'https://hub.example.com/alice/mcp/a' }],
  };

  it('closes only the top layer on Escape, traps Tab, and locks and restores page scroll', async () => {
    const onClose = jest.fn();
    document.body.style.overflow = '';
    render(
      <ConnectDialog
        aggregateUrl={endpoints.aggregate}
        servers={[
          {
            name: 'anteater-personal',
            selected: true,
            enabled: true,
            toolCount: null,
            status: { code: 'needs_auth', message: '', action: 'connect' },
          } as WorkspaceServer,
        ]}
        endpoints={endpoints}
        initial={{ service: 'anteater-personal', client: 'claude' }}
        onClose={onClose}
      />,
    );
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.click(screen.getByText('connect.bindCredentials'));
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
    render(
      <ConnectDialog
        aggregateUrl={endpoints.aggregate}
        servers={[
          {
            name: 'anteater-personal',
            selected: true,
            enabled: true,
            toolCount: null,
            status: { code: 'needs_auth', message: '', action: 'connect' },
          } as WorkspaceServer,
        ]}
        endpoints={endpoints}
        initial={{ service: 'anteater-personal', client: 'claude' }}
        onClose={jest.fn()}
      />,
    );
    const opener = screen.getByText('connect.bindCredentials');
    fireEvent.click(opener);
    await screen.findByTestId('credential-dialog');
    // The opener disappears (as it does once the service no longer needs credentials).
    opener.remove();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('credential-dialog')).toBeNull());
    expect(screen.getByTestId('connect-dialog').contains(document.activeElement)).toBe(true);
  });
});

describe('credential changes made in the dialog', () => {
  it('are announced to the workspace list', async () => {
    mockApiPut.mockImplementation(() => ok({}));
    const heard = jest.fn();
    const off = onWorkspaceChanged(heard);
    render(<CredentialDialog serverName="anteater-personal" onClose={jest.fn()} />);
    await screen.findByLabelText('anteater-personal');
    expect(heard).not.toHaveBeenCalled();
    fireEvent.change(document.querySelector('input[type="password"]') as HTMLInputElement, {
      target: { value: 'secret-value' },
    });
    await act(async () => {
      fireEvent.click(screen.getByText('credentials.save'));
    });
    await waitFor(() => expect(heard).toHaveBeenCalled());
    off();
  });
});
