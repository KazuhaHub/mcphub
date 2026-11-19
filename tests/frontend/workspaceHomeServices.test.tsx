/**
 * @jest-environment jsdom
 */
import '../utils/textEncoderPolyfill';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import React from 'react';
import type {
  MyCredentialBinding,
  UserServiceEntry,
  WorkspaceEndpoints,
  WorkspaceServer,
} from '../../frontend/src/types';
import WorkspaceHome from '../../frontend/src/components/workspace/WorkspaceHome';
import WorkspaceServicesView from '../../frontend/src/components/workspace/WorkspaceServicesView';
import UserServicesDialog from '../../frontend/src/components/UserServicesDialog';
import WorkspaceServicePage from '../../frontend/src/pages/WorkspaceServicePage';
import { resetWorkspaceStore } from '../../frontend/src/hooks/useWorkspaceData';
import {
  attentionItems,
  searchCatalog,
  summarizeServices,
} from '../../frontend/src/utils/workspace';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars?.name
        ? `${key}:${vars.name}`
        : vars && 'on' in vars
          ? `${key}:${vars.on}/${vars.added}`
          : vars && 'count' in vars
            ? `${key}:${vars.count}`
            : key,
  }),
}));
jest.mock('@/components/connect/ConnectDialog', () => ({ __esModule: true, default: () => null }));
const mockToast = jest.fn();
jest.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast: mockToast }) }));

const mockServers = jest.fn();
const mockBindings = jest.fn();
const mockMembership = jest.fn();
const mockLaunch = jest.fn();
const mockUserServices = jest.fn();
const mockSaveUserService = jest.fn();
jest.mock('@/services/workspaceService', () => ({
  fetchWorkspaceServers: () => mockServers(),
  fetchWorkspaceEndpoints: () => Promise.resolve(endpoints),
  fetchCredentialBindings: () => mockBindings(),
  saveServerSelection: jest.fn(() => Promise.resolve()),
  saveServerMembership: (...args: unknown[]) => mockMembership(...args),
  saveRiskCeiling: jest.fn(() => Promise.resolve()),
  launchPersonalOAuth: (...args: unknown[]) => mockLaunch(...args),
  fetchUserServices: (...args: unknown[]) => mockUserServices(...args),
  saveUserService: (...args: unknown[]) => mockSaveUserService(...args),
}));
jest.mock('@/utils/fetchInterceptor', () => ({
  apiGet: jest.fn(() => Promise.resolve({ success: true, data: [] })),
  apiPut: jest.fn(() => Promise.resolve({ success: true, data: {} })),
  apiPost: jest.fn(),
  apiDelete: jest.fn(),
}));

const endpoints: WorkspaceEndpoints = { aggregate: 'https://hub.example.com/u/mcp', servers: [] };
const base = {
  enabled: true,
  riskCeiling: 'read',
  riskCeilingIsDefault: false,
  annotationsTrusted: true,
  maxAllowedRisk: 'external',
  requiresPersonalCredential: false,
  credentialConfigured: false,
  toolCount: null,
  riskCounts: null,
};
const ready = { code: 'available', message: '', action: null };
const off = { code: 'not_selected', message: '', action: 'select' };
const signIn = { code: 'needs_auth', message: '', action: 'connect' };
const make = (name: string, extra: Record<string, unknown>) =>
  ({ ...base, name, ...extra }) as unknown as WorkspaceServer;
// Production-like: anteater-shared ready, anteater-personal off, ubc-public ready, ubc-personal
// off, canvas-portal on and needing sign-in.
const fresh = (): WorkspaceServer[] => [
  make('anteater-shared', {
    added: true,
    selected: true,
    description: 'Anteater MCP.',
    tags: ['campus'],
    status: ready,
  }),
  make('anteater-personal', {
    added: false,
    selected: false,
    description: 'Personal Anteater.',
    status: off,
  }),
  make('ubc-public', { added: true, selected: true, status: ready }),
  make('ubc-personal', {
    added: false,
    selected: false,
    description: 'UBC with your login',
    tags: ['university'],
    status: off,
  }),
  make('canvas-portal', {
    added: true,
    selected: true,
    hasCredentialSlots: false,
    status: signIn,
  }),
];
const bindings: MyCredentialBinding[] = [];

let servers: WorkspaceServer[];
const Where: React.FC = () => {
  const location = useLocation();
  return <div data-testid="where">{location.pathname + location.search}</div>;
};
const where = () => screen.getByTestId('where').textContent;
const mountAt = async (entry: string, wait: string) => {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/workspace" element={<WorkspaceHome />} />
        <Route path="/workspace/services" element={<WorkspaceServicesView />} />
        <Route path="/workspace/services/:name" element={<WorkspaceServicePage />} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
  await screen.findByTestId(wait);
  await act(async () => {});
};

beforeEach(() => {
  resetWorkspaceStore();
  servers = fresh();
  mockToast.mockReset();
  mockLaunch.mockReset().mockResolvedValue({ kind: 'started' });
  mockMembership.mockReset().mockImplementation(async (name: string, added: boolean) => {
    servers = servers.map((server) =>
      server.name === name ? { ...server, added, selected: added } : server,
    );
  });
  mockServers
    .mockReset()
    .mockImplementation(() => Promise.resolve(JSON.parse(JSON.stringify(servers))));
  mockBindings
    .mockReset()
    .mockImplementation(() => Promise.resolve(JSON.parse(JSON.stringify(bindings))));
  document.body.style.overflow = '';
});

describe('the helpers', () => {
  it('count what is on and what could still be added', () => {
    expect(summarizeServices(servers)).toEqual({ added: 3, on: 3, available: 2 });
  });

  it('search the catalog by name, description and tags, never listing added services', () => {
    expect(searchCatalog(servers, '').map((s) => s.name)).toEqual([
      'anteater-personal',
      'ubc-personal',
    ]);
    expect(searchCatalog(servers, 'UBC').map((s) => s.name)).toEqual(['ubc-personal']);
    expect(searchCatalog(servers, 'login').map((s) => s.name)).toEqual(['ubc-personal']);
    expect(searchCatalog(servers, 'university').map((s) => s.name)).toEqual(['ubc-personal']);
    expect(searchCatalog(servers, 'ubc login').map((s) => s.name)).toEqual(['ubc-personal']);
    expect(searchCatalog(servers, 'campus')).toEqual([]);
    expect(searchCatalog(servers, 'zzz')).toEqual([]);
  });

  it('flag only added, switched-on services that need action', () => {
    const list = [
      ...servers,
      make('off-and-stuck', { added: true, selected: false, status: off }),
      make('unlisted-stuck', { added: false, selected: false, status: signIn }),
      make('no-access', {
        added: true,
        selected: true,
        status: { code: 'needs_auth', message: '', action: 'contact_admin' },
      }),
      make('paused', {
        added: true,
        selected: true,
        status: { code: 'paused', message: '', action: null },
      }),
    ];
    expect(attentionItems(list, null, null).map((item) => [item.server.name, item.chip])).toEqual([
      ['canvas-portal', 'needs_signin'],
      ['no-access', 'contact_admin'],
    ]);
  });
});

describe('the Home page', () => {
  it('lists only what needs the user, each with its one action, and the counts', async () => {
    await mountAt('/workspace', 'home-attention');
    const card = screen.getByTestId('home-attention');
    expect(within(card).getAllByRole('listitem')).toHaveLength(1);
    const item = screen.getByTestId('home-attention-canvas-portal');
    expect(item.querySelector('[data-chip]')!.getAttribute('data-chip')).toBe('needs_signin');
    expect(screen.getByTestId('home-action-canvas-portal').textContent).toBe(
      'workspacePage.chip.action.signin',
    );
    // No list of services here.
    expect(screen.queryByTestId('workspace-service-anteater-shared')).toBeNull();
    expect(screen.queryByText('anteater-shared')).toBeNull();
    expect(screen.getByTestId('home-counts').textContent).toContain(
      'workspacePage.home.counts:3/3',
    );
    expect(screen.getByTestId('home-counts').textContent).toContain(
      'workspacePage.home.countsMore:2',
    );
  });

  it('signs in in place, with the same handler as the list', async () => {
    await mountAt('/workspace', 'home-attention');
    fireEvent.click(screen.getByTestId('home-action-canvas-portal'));
    await waitFor(() => expect(mockLaunch).toHaveBeenCalledWith('canvas-portal'));
    expect(where()).toBe('/workspace');
  });

  it('opens the credentials tab for a credentials action, and the service page from the name', async () => {
    servers = servers.map((server) =>
      server.name === 'canvas-portal' ? { ...server, hasCredentialSlots: true } : server,
    );
    await mountAt('/workspace', 'home-attention');
    expect(screen.getByTestId('home-action-canvas-portal').textContent).toBe(
      'workspacePage.chip.action.credentials',
    );
    fireEvent.click(screen.getByTestId('home-action-canvas-portal'));
    await waitFor(() => expect(where()).toBe('/workspace/services/canvas-portal?tab=credentials'));
  });

  it('links each row to its service page', async () => {
    await mountAt('/workspace', 'home-attention');
    const link = within(screen.getByTestId('home-attention-canvas-portal')).getByRole('link');
    expect(link.getAttribute('href')).toBe('/workspace/services/canvas-portal');
  });

  it('hides the attention card when nothing needs attention', async () => {
    servers = servers.map((server) =>
      server.name === 'canvas-portal' ? { ...server, status: ready } : server,
    ) as WorkspaceServer[];
    await mountAt('/workspace', 'home-counts');
    expect(screen.queryByTestId('home-attention')).toBeNull();
  });

  it('links the counts line to the services page', async () => {
    await mountAt('/workspace', 'home-counts');
    const link = within(screen.getByTestId('home-counts')).getByRole('link');
    expect(link.getAttribute('href')).toBe('/workspace/services');
  });

  it('shows a get-started hint with a button to Services when nothing is on', async () => {
    servers = servers.map((server) => ({
      ...server,
      added: false,
      selected: false,
    })) as WorkspaceServer[];
    await mountAt('/workspace', 'home-get-started');
    expect(screen.queryByTestId('home-counts')).toBeNull();
    expect(screen.queryByTestId('home-attention')).toBeNull();
    const button = within(screen.getByTestId('home-get-started')).getByRole('link');
    expect(button.getAttribute('href')).toBe('/workspace/services');
  });

  it('does not count a service that is added but switched off as on', async () => {
    servers = servers.map((server) =>
      server.name === 'anteater-shared' ? { ...server, selected: false } : server,
    );
    await mountAt('/workspace', 'home-counts');
    expect(screen.getByTestId('home-counts').textContent).toContain(
      'workspacePage.home.counts:2/3',
    );
  });
});

describe('the Services page', () => {
  it('lists only the services the user added', async () => {
    await mountAt('/workspace/services', 'workspace-service-anteater-shared');
    expect(screen.getByTestId('workspace-service-ubc-public')).toBeTruthy();
    expect(screen.getByTestId('workspace-service-canvas-portal')).toBeTruthy();
    expect(screen.queryByTestId('workspace-service-anteater-personal')).toBeNull();
    expect(screen.queryByTestId('workspace-service-ubc-personal')).toBeNull();
  });

  it('says so, with an Add button, when nothing was added', async () => {
    servers = servers.map((server) => ({
      ...server,
      added: false,
      selected: false,
    })) as WorkspaceServer[];
    await mountAt('/workspace/services', 'services-empty');
    expect(screen.getByTestId('services-empty').textContent).toContain(
      'workspacePage.services.noneAdded',
    );
  });

  describe('the catalog', () => {
    const open = async () => {
      await mountAt('/workspace/services', 'workspace-service-anteater-shared');
      fireEvent.click(screen.getByTestId('add-service'));
      return screen.getByTestId('add-service-dialog');
    };

    it('opens as a dialog with a search box and the services not yet added', async () => {
      const dialog = await open();
      expect(dialog.getAttribute('role')).toBe('dialog');
      expect(dialog.getAttribute('aria-modal')).toBe('true');
      expect(document.activeElement).toBe(screen.getByTestId('catalog-search'));
      expect(within(dialog).getByTestId('catalog-item-anteater-personal')).toBeTruthy();
      expect(within(dialog).getByTestId('catalog-item-ubc-personal')).toBeTruthy();
      expect(within(dialog).queryByTestId('catalog-item-anteater-shared')).toBeNull();
      expect(within(dialog).getByTestId('catalog-item-ubc-personal').textContent).toContain(
        'UBC with your login',
      );
    });

    it('narrows by name, description and tag, and says when nothing matches', async () => {
      const dialog = await open();
      const search = screen.getByTestId('catalog-search');
      fireEvent.change(search, { target: { value: 'university' } });
      expect(within(dialog).queryByTestId('catalog-item-anteater-personal')).toBeNull();
      expect(within(dialog).getByTestId('catalog-item-ubc-personal')).toBeTruthy();
      fireEvent.change(search, { target: { value: 'nothing-like-this' } });
      expect(screen.getByTestId('catalog-empty').textContent).toContain(
        'workspacePage.catalog.noMatch',
      );
    });

    it('adds a service to the list, switched on, and drops it from the catalog', async () => {
      const dialog = await open();
      fireEvent.click(within(dialog).getByTestId('catalog-add-ubc-personal'));
      await waitFor(() => expect(mockMembership).toHaveBeenCalledWith('ubc-personal', true));
      await screen.findByTestId('workspace-service-ubc-personal');
      expect(within(dialog).queryByTestId('catalog-item-ubc-personal')).toBeNull();
      expect(
        within(screen.getByTestId('workspace-service-ubc-personal'))
          .getByRole('switch')
          .getAttribute('aria-checked'),
      ).toBe('true');
    });

    it('puts the row back and tells the user when adding fails', async () => {
      mockMembership.mockRejectedValueOnce(new Error('nope'));
      const dialog = await open();
      fireEvent.click(within(dialog).getByTestId('catalog-add-ubc-personal'));
      await waitFor(() =>
        expect(mockToast).toHaveBeenCalledWith(
          'workspacePage.catalog.addFailed:ubc-personal',
          'error',
        ),
      );
      expect(screen.queryByTestId('workspace-service-ubc-personal')).toBeNull();
    });

    it('closes with Escape', async () => {
      await open();
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByTestId('add-service-dialog')).toBeNull();
    });
  });

  describe('removing a service', () => {
    it('asks first, then takes it off the list and returns to it', async () => {
      await mountAt('/workspace/services/ubc-public', 'service-remove');
      fireEvent.click(screen.getByTestId('service-remove'));
      expect(mockMembership).not.toHaveBeenCalled();
      fireEvent.click(
        within(screen.getByRole('dialog')).getByRole('button', {
          name: 'workspacePage.catalog.remove',
        }),
      );
      await waitFor(() => expect(mockMembership).toHaveBeenCalledWith('ubc-public', false));
      await waitFor(() => expect(where()).toBe('/workspace/services'));
      await screen.findByTestId('workspace-service-anteater-shared');
      expect(screen.queryByTestId('workspace-service-ubc-public')).toBeNull();
    });

    it('does nothing when the user cancels', async () => {
      await mountAt('/workspace/services/ubc-public', 'service-remove');
      fireEvent.click(screen.getByTestId('service-remove'));
      fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }));
      expect(mockMembership).not.toHaveBeenCalled();
      expect(where()).toBe('/workspace/services/ubc-public');
    });

    it('offers Add instead of a switch on a service that is not in the list', async () => {
      await mountAt('/workspace/services/ubc-personal', 'service-add');
      expect(screen.queryByTestId('service-toggle')).toBeNull();
      expect(screen.queryByTestId('service-remove')).toBeNull();
      fireEvent.click(screen.getByTestId('service-add'));
      await waitFor(() => expect(mockMembership).toHaveBeenCalledWith('ubc-personal', true));
    });
  });
});

describe('the administrator’s services panel', () => {
  const entries: UserServiceEntry[] = [
    { name: 'anteater-shared', added: true, selected: true },
    { name: 'ubc-personal', added: true, selected: false },
    { name: 'canvas-portal', added: false, selected: false },
  ];
  let current: UserServiceEntry[];

  beforeEach(() => {
    current = JSON.parse(JSON.stringify(entries));
    mockUserServices
      .mockReset()
      .mockImplementation(() => Promise.resolve(JSON.parse(JSON.stringify(current))));
    mockSaveUserService
      .mockReset()
      .mockImplementation(
        async (_user: string, name: string, patch: { added?: boolean; selected?: boolean }) => {
          current = current.map((entry) =>
            entry.name === name
              ? {
                  ...entry,
                  ...patch,
                  ...(patch.added === false ? { selected: false } : {}),
                }
              : entry,
          );
        },
      );
  });

  const mountDialog = async () => {
    render(<UserServicesDialog username="bob" onClose={jest.fn()} />);
    await screen.findByTestId('user-service-anteater-shared');
  };

  it('shows each service the user can see with its Added and Enabled state', async () => {
    await mountDialog();
    expect(mockUserServices).toHaveBeenCalledWith('bob');
    const state = (name: string, kind: 'added' | 'enabled') =>
      screen.getByTestId(`user-service-${kind}-${name}`).getAttribute('aria-checked');
    expect(state('anteater-shared', 'added')).toBe('true');
    expect(state('anteater-shared', 'enabled')).toBe('true');
    expect(state('ubc-personal', 'enabled')).toBe('false');
    expect(state('canvas-portal', 'added')).toBe('false');
    // Nothing to switch on in a list the service is not in.
    expect(
      (screen.getByTestId('user-service-enabled-canvas-portal') as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('adds, enables, disables and removes for the user', async () => {
    await mountDialog();
    fireEvent.click(screen.getByTestId('user-service-added-canvas-portal'));
    await waitFor(() =>
      expect(mockSaveUserService).toHaveBeenCalledWith('bob', 'canvas-portal', { added: true }),
    );
    fireEvent.click(screen.getByTestId('user-service-enabled-ubc-personal'));
    await waitFor(() =>
      expect(mockSaveUserService).toHaveBeenCalledWith('bob', 'ubc-personal', { selected: true }),
    );
    fireEvent.click(screen.getByTestId('user-service-enabled-anteater-shared'));
    await waitFor(() =>
      expect(mockSaveUserService).toHaveBeenCalledWith('bob', 'anteater-shared', {
        selected: false,
      }),
    );
    fireEvent.click(screen.getByTestId('user-service-added-anteater-shared'));
    await waitFor(() =>
      expect(mockSaveUserService).toHaveBeenCalledWith('bob', 'anteater-shared', { added: false }),
    );
    await waitFor(() =>
      expect(
        screen.getByTestId('user-service-added-anteater-shared').getAttribute('aria-checked'),
      ).toBe('false'),
    );
  });
});
