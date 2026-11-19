/**
 * @jest-environment jsdom
 */
import { createElement } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type {
  MyCredentialBinding,
  WorkspaceEndpoints,
  WorkspaceServer,
} from '../../frontend/src/types';
import CredentialDialog from '../../frontend/src/components/credentials/CredentialDialog';
import ConnectDialog from '../../frontend/src/components/connect/ConnectDialog';
import WorkspaceServiceRow from '../../frontend/src/components/workspace/WorkspaceServiceRow';
import CredentialsPage from '../../frontend/src/pages/CredentialsPage';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, string>) =>
      vars?.name ? `${key}:${vars.name}` : vars?.server ? `${key}:${vars.server}` : key,
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
jest.mock('react-router-dom', () => ({
  Navigate: ({ to }: { to: string }) => <div data-testid="navigate" data-to={to} />,
  useSearchParams: () => [new URLSearchParams(mockSearch), jest.fn()],
}));
let mockAdmin = false;
let mockWorkspace = true;
jest.mock('../../frontend/src/contexts/AuthContext', () => ({
  useAuth: () => ({ auth: { user: { username: 'u', isAdmin: mockAdmin } } }),
}));
jest.mock('../../frontend/src/contexts/SettingsContext', () => ({
  useSettings: () => ({ workspaceEnabled: mockWorkspace }),
}));

const binding = (serverName: string, extra: Partial<MyCredentialBinding> = {}): MyCredentialBinding => ({
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
  mockAdmin = false;
  mockWorkspace = true;
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
    render(<CredentialDialog serverName="anteater-personal" onChanged={onChanged} onClose={jest.fn()} />);
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

const row = (binding: MyCredentialBinding | undefined, server: Partial<WorkspaceServer> = {}) => {
  const onConfigureCredentials = jest.fn();
  const onAction = jest.fn();
  render(
    createElement('ul', null, [
      createElement(WorkspaceServiceRow, {
        key: 'row',
        server: {
          name: 'anteater-personal',
          selected: true,
          enabled: true,
          toolCount: null,
          riskCeiling: 'read',
          riskCeilingIsDefault: true,
          riskCounts: null,
          annotationsTrusted: true,
          maxAllowedRisk: 'external',
          requiresPersonalCredential: true,
          credentialConfigured: false,
          status: { code: 'needs_auth', message: '', action: 'connect' },
          ...server,
        } as WorkspaceServer,
        credentialServers: new Set(['anteater-personal']),
        credentialBinding: binding,
        busy: false,
        onToggle: jest.fn(),
        onRiskChange: jest.fn(),
        onAction,
        onCopyEndpoint: jest.fn(),
        onConnectToAi: jest.fn(),
        onConfigureCredentials,
      }),
    ]),
  );
  return { onConfigureCredentials, onAction };
};

describe('credential state on a workspace service row', () => {
  it('shows "binding required" and opens the panel from the badge and the action', () => {
    const { onConfigureCredentials, onAction } = row(bindings[0]);
    const badge = screen.getByTestId('credential-badge-anteater-personal');
    expect(badge.getAttribute('data-credential-state')).toBe('required');
    expect(badge.textContent).toBe('workspacePage.credentialBadge.required');
    fireEvent.click(badge);
    expect(onConfigureCredentials).toHaveBeenCalledWith('anteater-personal');
    fireEvent.click(screen.getByText('workspacePage.actions.configureCredentials'));
    expect(onAction).toHaveBeenCalledWith({ kind: 'credentials', server: 'anteater-personal' });
  });

  it('shows "credentials outdated" when the connection settings changed', () => {
    row(bindings[1]);
    expect(
      screen.getByTestId('credential-badge-anteater-personal').getAttribute('data-credential-state'),
    ).toBe('outdated');
  });

  it('shows the bound state and a manage action once the credentials are set', () => {
    const { onConfigureCredentials } = row(bindings[2], {
      status: { code: 'available', message: '', action: null },
      credentialConfigured: true,
    });
    expect(
      screen.getByTestId('credential-badge-anteater-personal').getAttribute('data-credential-state'),
    ).toBe('bound');
    fireEvent.click(screen.getByText('workspacePage.actions.manageCredentials'));
    expect(onConfigureCredentials).toHaveBeenCalledWith('anteater-personal');
  });

  it('shows no badge for a service without credential slots', () => {
    row(undefined, {
      requiresPersonalCredential: false,
      status: { code: 'available', message: '', action: null },
    });
    expect(screen.queryByTestId('credential-badge-anteater-personal')).toBeNull();
  });
});

describe('the Connect to AI prompt for missing credentials', () => {
  const endpoints: WorkspaceEndpoints = {
    aggregate: 'https://hub.example.com/alice/mcp',
    servers: [{ name: 'anteater-personal', url: 'https://hub.example.com/alice/mcp/anteater-personal' }],
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
