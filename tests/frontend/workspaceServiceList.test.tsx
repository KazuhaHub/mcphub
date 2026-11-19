/**
 * @jest-environment jsdom
 */
import '../utils/textEncoderPolyfill';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import React from 'react';
import type {
  MyCredentialBinding,
  WorkspaceEndpoints,
  WorkspaceServer,
} from '../../frontend/src/types';
import WorkspaceServicesView from '../../frontend/src/components/workspace/WorkspaceServicesView';
import { resetWorkspaceStore } from '../../frontend/src/hooks/useWorkspaceData';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars?.name ? `${key}:${vars.name}` : vars && 'count' in vars ? `${key}:${vars.count}` : key,
  }),
}));
const mockToast = jest.fn();
jest.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast: mockToast }) }));

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
const Where: React.FC = () => {
  const location = useLocation();
  return (
    <div data-testid="where" data-state={JSON.stringify(location.state)}>
      {location.pathname + location.search}
    </div>
  );
};
const where = () => screen.getByTestId('where').textContent;
const mount = async () => {
  render(
    <MemoryRouter initialEntries={['/workspace']}>
      <Routes>
        <Route path="/workspace" element={<WorkspaceServicesView />} />
        <Route path="/workspace/services/:name" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByTestId('workspace-service-anteater-shared');
  await waitFor(() => expect(mockBindings).toHaveBeenCalled());
  await act(async () => {});
};

beforeEach(() => {
  resetWorkspaceStore();
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

  it('goes to the service page on a click anywhere on the row', async () => {
    await mount();
    fireEvent.click(row('anteater-shared'));
    expect(where()).toBe('/workspace/services/anteater-shared');
  });

  it('is reachable and opened from the keyboard: a native button', async () => {
    await mount();
    const opener = screen.getByTestId('workspace-open-ubc-personal');
    expect(opener.tagName).toBe('BUTTON');
    opener.focus();
    // Enter and Space on a button are delivered as a click.
    fireEvent.click(opener);
    expect(where()).toBe('/workspace/services/ubc-personal');
  });

  it('does not leave the list from the switch, and still toggles the service', async () => {
    await mount();
    fireEvent.click(within(row('anteater-personal')).getByRole('switch'));
    expect(screen.queryByTestId('where')).toBeNull();
    await waitFor(() => expect(mockSave).toHaveBeenCalledWith('anteater-personal', true));
  });

  it('starts the sign-in in place from the action button', async () => {
    await mount();
    const { launchPersonalOAuth } = jest.requireMock('@/services/workspaceService');
    fireEvent.click(screen.getByTestId('workspace-action-canvas-portal'));
    expect(screen.queryByTestId('where')).toBeNull();
    await waitFor(() => expect(launchPersonalOAuth).toHaveBeenCalledWith('canvas-portal'));
  });

  it('goes to the credentials tab from a credentials action', async () => {
    await mount();
    fireEvent.click(screen.getByTestId('workspace-action-needs-keys'));
    expect(where()).toBe('/workspace/services/needs-keys?tab=credentials');
  });

  it('encodes the service name in the address', async () => {
    mockServers.mockImplementation(() =>
      Promise.resolve(
        clone(servers).map((s) => (s.name === 'broken' ? { ...s, name: 'a b/ü' } : s)),
      ),
    );
    await mount();
    fireEvent.click(row('a b/ü'));
    expect(where()).toBe('/workspace/services/a%20b%2F%C3%BC');
  });

  it('keeps one short explanation at the top of the list, not on rows', async () => {
    await mount();
    expect(screen.getByText('workspacePage.services.description')).toBeTruthy();
  });
});

describe('one source of truth', () => {
  it('refetches servers and bindings together when the window regains focus', async () => {
    await mount();
    const serversBefore = mockServers.mock.calls.length;
    const bindingsBefore = mockBindings.mock.calls.length;
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => expect(mockServers.mock.calls.length).toBeGreaterThan(serversBefore));
    expect(mockBindings.mock.calls.length).toBeGreaterThan(bindingsBefore);
  });

  it('refetches when the tab becomes visible again', async () => {
    await mount();
    const before = mockServers.mock.calls.length;
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(mockServers.mock.calls.length).toBeGreaterThan(before));
  });

  it('refreshes after a toggle, once', async () => {
    await mount();
    const before = mockServers.mock.calls.length;
    fireEvent.click(within(row('anteater-personal')).getByRole('switch'));
    await waitFor(() => expect(mockSave).toHaveBeenCalled());
    await act(async () => {});
    expect(mockServers.mock.calls.length - before).toBe(1);
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
  it('shows a rejected sign-in as sign in again', async () => {
    await mount();
    const li = row('oauth-rejected');
    expect(li.querySelector('[data-chip]')!.getAttribute('data-chip')).toBe('needs_signin');
    expect(screen.getByTestId('workspace-action-oauth-rejected').textContent).toBe(
      'workspacePage.chip.action.signinAgain',
    );
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
  it('says so and offers no action on the row', async () => {
    await mount();
    const li = row('no-access');
    expect(li.querySelector('[data-chip]')!.getAttribute('data-chip')).toBe('contact_admin');
    expect(li.querySelector('[data-testid^="workspace-action-"]')).toBeNull();
  });
});

describe('a blocked sign-in popup', () => {
  it('goes to the service page, carrying the link so it is visible there', async () => {
    const { launchPersonalOAuth } = jest.requireMock('@/services/workspaceService');
    launchPersonalOAuth.mockResolvedValueOnce({ kind: 'link', url: 'https://idp.example/auth' });
    await mount();
    fireEvent.click(screen.getByTestId('workspace-action-canvas-portal'));
    await waitFor(() => expect(where()).toBe('/workspace/services/canvas-portal'));
    expect(JSON.parse(screen.getByTestId('where').getAttribute('data-state')!)).toEqual({
      authorizationUrl: 'https://idp.example/auth',
    });
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
