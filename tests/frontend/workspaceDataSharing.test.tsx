/**
 * @jest-environment jsdom
 */
import '../utils/textEncoderPolyfill';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { MyCredentialBinding, WorkspaceServer } from '../../frontend/src/types';
import ConnectCard from '../../frontend/src/components/connect/ConnectCard';
import WorkspaceServicesView from '../../frontend/src/components/workspace/WorkspaceServicesView';
import WorkspaceServicePage from '../../frontend/src/pages/WorkspaceServicePage';
import { resetWorkspaceStore } from '../../frontend/src/hooks/useWorkspaceData';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars?.name ? `${key}:${vars.name}` : vars && 'count' in vars ? `${key}:${vars.count}` : key,
  }),
}));
jest.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast: jest.fn() }) }));
jest.mock('@/contexts/SettingsContext', () => ({
  useSettings: () => ({ smartRoutingConfig: { enabled: false } }),
}));

// "The server": every change bumps `version`, which shows in the endpoint the card displays and
// in what the list says, so each consumer visibly follows it.
let version = 0;
let servers: WorkspaceServer[] = [];
let bindings: MyCredentialBinding[] = [];
let bindingsGate: Promise<void> | null = null;
const mockSave = jest.fn();
const mockRisk = jest.fn();
const mockPut = jest.fn();
const mockLaunch = jest.fn();

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const view = () =>
  clone(servers).map((server) => ({
    ...server,
    // A credentials save at version >= 3 makes needs-keys usable.
    status:
      server.name === 'needs-keys' && version >= 3
        ? { code: 'available', message: '', action: null }
        : server.status,
  }));

jest.mock('@/services/workspaceService', () => ({
  fetchWorkspaceServers: () => Promise.resolve(view()),
  fetchWorkspaceEndpoints: () =>
    Promise.resolve({
      aggregate: `https://hub.example.com/v${version}/mcp`,
      servers: servers.map((s) => ({
        name: s.name,
        url: `https://hub.example.com/v${version}/mcp/${s.name}`,
      })),
    }),
  fetchCredentialBindings: async () => {
    await bindingsGate;
    return clone(bindings);
  },
  saveServerSelection: (...args: unknown[]) => mockSave(...args),
  saveRiskCeiling: (...args: unknown[]) => mockRisk(...args),
  launchPersonalOAuth: (...args: unknown[]) => mockLaunch(...args),
}));
jest.mock('@/utils/fetchInterceptor', () => ({
  apiGet: jest.fn(() => Promise.resolve({ success: true, data: [] })),
  apiPut: (...args: unknown[]) => mockPut(...args),
  apiPost: jest.fn(),
  apiDelete: jest.fn(),
}));

const base = {
  selected: true,
  enabled: true,
  riskCeiling: 'read',
  riskCeilingIsDefault: false,
  annotationsTrusted: true,
  maxAllowedRisk: 'external',
  toolCount: null,
  riskCounts: null,
};
const slotsBinding = (name: string): MyCredentialBinding => ({
  serverName: name,
  credentialTemplate: [{ target: 'env', name: 'API_KEY', label: 'API key' }],
  configured: false,
  configuredSlots: [],
  updatedAt: null,
});

beforeEach(() => {
  resetWorkspaceStore();
  version = 0;
  bindingsGate = null;
  for (const fn of [mockSave, mockRisk])
    fn.mockReset().mockImplementation(async () => void version++);
  mockPut.mockReset().mockImplementation(async () => {
    version = 3;
    return { success: true, data: {} };
  });
  mockLaunch.mockReset().mockResolvedValue({ kind: 'started' });
  servers = [
    {
      ...base,
      name: 'notes',
      requiresPersonalCredential: false,
      credentialConfigured: true,
      hasCredentialSlots: false,
      riskCounts: { read: 3, write: 2, external: 0 },
      toolCount: 3,
      status: { code: 'available', message: '', action: null },
    },
    {
      ...base,
      name: 'needs-keys',
      requiresPersonalCredential: true,
      credentialConfigured: false,
      hasCredentialSlots: true,
      status: { code: 'needs_auth', message: 'Needs credentials.', action: 'connect' },
    },
    {
      ...base,
      name: 'canvas-oauth',
      requiresPersonalCredential: true,
      credentialConfigured: false,
      hasCredentialSlots: false,
      status: { code: 'needs_auth', message: 'Sign in.', action: 'connect' },
    },
  ] as unknown as WorkspaceServer[];
  bindings = [slotsBinding('needs-keys')];
});
afterEach(() => resetWorkspaceStore());

// The workspace page and a service's page both show the Connect card above their own content.
const page = async (entry = '/workspace') => {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <ConnectCard />
      <Routes>
        <Route path="/workspace" element={<WorkspaceServicesView />} />
        <Route path="/workspace/services/:name" element={<WorkspaceServicePage />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByTestId(entry === '/workspace' ? 'workspace-service-notes' : 'service-title');
  await screen.findByTestId('connect-tiles');
  await act(async () => {});
};
const pageChip = () => screen.getByTestId('service-chip').getAttribute('data-chip');
const tabIds = () =>
  within(screen.getByTestId('service-tabs'))
    .getAllByRole('tab')
    .map((tab) => tab.id.replace('service-tab-', ''));
const endpointText = () => screen.getByLabelText('connect.endpoint').textContent;
const chip = (name: string) =>
  screen
    .getByTestId(`workspace-service-${name}`)
    .querySelector('[data-chip]')!
    .getAttribute('data-chip');

describe('every view of the workspace page reads one shared source', () => {
  it('shows the card and the list from the same single fetch path', async () => {
    await page();
    expect(endpointText()).toContain('/v0/');
    expect(chip('needs-keys')).toBe('needs_credentials');
  });

  it('follows a toggle on a row in the card and the list', async () => {
    await page();
    fireEvent.click(within(screen.getByTestId('workspace-service-notes')).getByRole('switch'));
    await waitFor(() => expect(endpointText()).toContain('/v1/'));
    expect(mockSave).toHaveBeenCalled();
  });

  it('follows a permission change made on the service page in the card', async () => {
    await page('/workspace/services/notes?tab=permissions');
    fireEvent.click(document.querySelector('[data-risk-level="write"]')!);
    await waitFor(() => expect(endpointText()).toContain('/v1/'));
    expect(mockRisk).toHaveBeenCalledWith('notes', 'write');
  });

  it('follows a credentials save made on the service page in the card and the page', async () => {
    await page('/workspace/services/needs-keys');
    await screen.findByLabelText('needs-keys');
    fireEvent.change(document.querySelector('input[type="password"]') as HTMLInputElement, {
      target: { value: 'secret-value' },
    });
    await act(async () => {
      fireEvent.click(screen.getByText('credentials.save'));
    });
    await waitFor(() => expect(pageChip()).toBe('ready'));
    expect(endpointText()).toContain('/v3/');
  });

  it('follows a credentials save made in the Connect dialog opened from the card', async () => {
    await page();
    fireEvent.click(screen.getByText('connect.singleService'));
    const dialog = await screen.findByTestId('connect-dialog');
    fireEvent.click(within(dialog).getByText('needs-keys'));
    fireEvent.click(await within(dialog).findByTestId('connect-tile-claude'));
    fireEvent.click(await within(dialog).findByText('workspacePage.chip.action.credentials'));
    const credentials = await screen.findByTestId('credential-dialog');
    await within(credentials).findByLabelText('needs-keys');
    fireEvent.change(credentials.querySelector('input[type="password"]') as HTMLInputElement, {
      target: { value: 'secret-value' },
    });
    await act(async () => {
      fireEvent.click(within(credentials).getByText('credentials.save'));
    });
    await waitFor(() => expect(chip('needs-keys')).toBe('ready'));
    expect(endpointText()).toContain('/v3/');
  });

  it('picks up a sign-in finished in another tab when the window regains focus', async () => {
    await page();
    // The user signed in elsewhere; the server now says so.
    version = 3;
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => expect(endpointText()).toContain('/v3/'), { timeout: 2000 });
    expect(chip('needs-keys')).toBe('ready');
  });

  it('refreshes after starting a sign-in without waiting for it to finish', async () => {
    await page();
    fireEvent.click(screen.getByTestId('workspace-action-canvas-oauth'));
    await waitFor(() => expect(mockLaunch).toHaveBeenCalledWith('canvas-oauth'));
    // Nothing was announced early: the card still shows what the server last said, and the next
    // refresh (here the focus on return) shows the finished sign-in.
    version = 5;
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => expect(endpointText()).toContain('/v5/'), { timeout: 2000 });
  });
});

describe('the credentials tab for each kind of service', () => {
  it('has none for a personal sign-in, before and after the bindings load', async () => {
    let release: () => void = () => undefined;
    bindingsGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page('/workspace/services/canvas-oauth?tab=credentials');
    // The server says it has no slots, so the tab never appears.
    expect(tabIds()).toEqual(['overview', 'permissions']);
    await act(async () => release());
    await act(async () => {});
    expect(tabIds()).toEqual(['overview', 'permissions']);
  });

  it('has one for a service that takes credentials', async () => {
    await page('/workspace/services/needs-keys');
    expect(tabIds()).toEqual(['overview', 'credentials', 'permissions']);
    expect(
      within(screen.getByTestId('service-tabs'))
        .getByText('workspacePage.service.tab.credentials')
        .getAttribute('aria-selected'),
    ).toBe('true');
  });

  it('waits for the data before deciding when the server does not say', async () => {
    servers = servers.map((s) => {
      const copy = { ...s } as Partial<WorkspaceServer>;
      delete copy.hasCredentialSlots;
      return copy as WorkspaceServer;
    });
    let release: () => void = () => undefined;
    bindingsGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page('/workspace/services/canvas-oauth');
    // Until the bindings are known the credentials are the safer guess.
    expect(tabIds()).toContain('credentials');
    await act(async () => release());
    await act(async () => {});
    // The bindings list has no slots for it: it signs in, so there is no credentials tab.
    await waitFor(() => expect(tabIds()).toEqual(['overview', 'permissions']));
  });
});
