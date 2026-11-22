/**
 * @jest-environment jsdom
 */
import '../utils/textEncoderPolyfill';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import React from 'react';
import type {
  WorkspaceEndpoints,
  WorkspaceReadiness,
  WorkspaceServer,
} from '../../frontend/src/types';
import WorkspaceServicePage from '../../frontend/src/pages/WorkspaceServicePage';
import WorkspaceServiceRow from '../../frontend/src/components/workspace/WorkspaceServiceRow';
import { resetWorkspaceStore } from '../../frontend/src/hooks/useWorkspaceData';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars?.name
        ? `${key}:${vars.name}`
        : vars && 'date' in vars
          ? `${key}:date`
          : vars && 'count' in vars
            ? `${key}:${vars.count}`
            : key,
  }),
}));
jest.mock('@/components/connect/ConnectDialog', () => ({ __esModule: true, default: () => null }));
const mockToast = jest.fn();
jest.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast: mockToast }) }));

const mockServers = jest.fn();
const mockCheck = jest.fn();
jest.mock('@/services/workspaceService', () => ({
  fetchWorkspaceServers: () => mockServers(),
  fetchWorkspaceEndpoints: () => Promise.resolve(endpoints),
  fetchCredentialBindings: () => Promise.resolve([]),
  checkWorkspaceReadiness: (...args: unknown[]) => mockCheck(...args),
  saveServerSelection: jest.fn(),
  saveRiskCeiling: jest.fn(),
  launchPersonalOAuth: jest.fn(() => Promise.resolve({ kind: 'started' })),
}));
jest.mock('@/utils/fetchInterceptor', () => ({
  apiGet: jest.fn(() => Promise.resolve({ success: true, data: [] })),
  apiPut: jest.fn(),
  apiPost: jest.fn(),
  apiDelete: jest.fn(),
}));

const endpoints: WorkspaceEndpoints = {
  aggregate: 'https://hub.example.com/u/mcp',
  servers: [{ name: 'canvas', url: 'https://hub.example.com/u/mcp/canvas' }],
};

const needsSetup: WorkspaceReadiness = {
  state: 'needs_setup',
  summary: 'No Canvas token saved yet.',
  action: { label: 'Set up Canvas token', url: 'https://canvas.example.com/setup' },
  expiresAt: null,
  checkedAt: '2026-11-19T10:00:00.000Z',
};
const ready: WorkspaceReadiness = {
  state: 'ready',
  summary: null,
  action: null,
  expiresAt: null,
  checkedAt: '2026-11-19T10:05:00.000Z',
};

const canvas = (extra: Partial<WorkspaceServer> = {}): WorkspaceServer =>
  ({
    name: 'canvas',
    added: true,
    selected: true,
    enabled: true,
    toolCount: null,
    riskCeiling: 'read',
    riskCeilingIsDefault: false,
    riskCounts: null,
    annotationsTrusted: true,
    maxAllowedRisk: 'external',
    requiresPersonalCredential: true,
    hasCredentialSlots: false,
    credentialConfigured: true,
    manageUrl: 'https://canvas.example.com/account',
    readiness: needsSetup,
    status: { code: 'available', message: '', action: null },
    ...extra,
  }) as WorkspaceServer;

const mountPage = async (server: WorkspaceServer) => {
  mockServers.mockImplementation(() => Promise.resolve([JSON.parse(JSON.stringify(server))]));
  render(
    <MemoryRouter initialEntries={['/workspace/services/canvas']}>
      <Routes>
        <Route path="/workspace/services/:name" element={<WorkspaceServicePage />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByTestId('service-title');
  await act(async () => {});
};
const panel = () => screen.getByTestId('service-readiness');
const connectButton = () => screen.getByLabelText('connect.rowActionFor:canvas');

let open: jest.SpyInstance;
beforeEach(() => {
  resetWorkspaceStore();
  mockToast.mockReset();
  mockServers.mockReset();
  mockCheck.mockReset().mockResolvedValue(ready);
  open = jest.spyOn(window, 'open').mockImplementation(() => null);
});
afterEach(() => open.mockRestore());

describe('the readiness block in a service page', () => {
  it('shows the service summary as plain text, not the generic connected text', async () => {
    await mountPage(
      canvas({ readiness: { ...needsSetup, summary: '<img src=x onerror=alert(1)>' } }),
    );
    expect(panel().getAttribute('data-state')).toBe('needs_setup');
    expect(panel().textContent).toContain('<img src=x onerror=alert(1)>');
    expect(panel().querySelector('img')).toBeNull();
    expect(document.body.textContent).not.toContain('workspacePage.risk.connectedPending');
  });

  it('falls back to wording for the state when the service gave no summary', async () => {
    await mountPage(
      canvas({ readiness: { ...needsSetup, state: 'revoked', summary: null, action: null } }),
    );
    expect(panel().textContent).toContain('workspacePage.readiness.text.revoked');
    expect(panel().getAttribute('data-tone')).toBe('err');
  });

  it('shows a green ready state and keeps Connect to AI primary', async () => {
    await mountPage(canvas({ readiness: ready }));
    expect(panel().getAttribute('data-state')).toBe('ready');
    expect(panel().getAttribute('data-tone')).toBe('ok');
    expect(panel().textContent).toContain('workspacePage.readiness.state.ready');
    expect(connectButton().className).toContain('primary');
    expect(screen.queryByTestId('readiness-action')).toBeNull();
  });

  it('puts the service action first as the primary button and demotes Connect to AI', async () => {
    await mountPage(canvas());
    const action = screen.getByTestId('readiness-action');
    expect(action.tagName).toBe('BUTTON');
    expect(action.className).toContain('hub-btn');
    expect(action.className).toContain('primary');
    expect(action.textContent).toContain('Set up Canvas token');
    expect(connectButton().className).not.toContain('primary');
    const row = action.parentElement!;
    expect(row.firstElementChild).toBe(action);
    fireEvent.click(action);
    expect(open).toHaveBeenCalledWith(
      'https://canvas.example.com/setup',
      '_blank',
      'noopener,noreferrer',
    );
  });

  it('keeps Connect to AI primary when the state has no action', async () => {
    await mountPage(canvas({ readiness: { ...needsSetup, action: null } }));
    expect(screen.queryByTestId('readiness-action')).toBeNull();
    expect(connectButton().className).toContain('primary');
  });

  it('never renders an unsafe action link', async () => {
    await mountPage(
      canvas({ readiness: { ...needsSetup, action: { label: 'Go', url: 'javascript:alert(1)' } } }),
    );
    expect(screen.queryByTestId('readiness-action')).toBeNull();
  });

  it('notes when the setup expires', async () => {
    await mountPage(
      canvas({
        readiness: {
          ...needsSetup,
          state: 'expiring',
          expiresAt: new Date(Date.now() + 5 * 86400_000).toISOString(),
        },
      }),
    );
    expect(panel().textContent).toContain('workspacePage.readiness.expiresAt:date');
  });

  it('is absent, and the old text stays, for a service without readiness', async () => {
    await mountPage(canvas({ readiness: null }));
    expect(screen.queryByTestId('service-readiness')).toBeNull();
    expect(screen.queryByText('workspacePage.readiness.recheck')).toBeNull();
    expect(screen.getByTestId('service-tools').textContent).toBe(
      'workspacePage.risk.connectedPending',
    );
  });
});

describe('Manage account', () => {
  const manage = () =>
    screen.getByRole('link', { name: 'workspacePage.actions.manageAccountFor:canvas' });

  it('looks like a button but is a real link, so middle-click and copy-link work', async () => {
    await mountPage(canvas({ readiness: null }));
    const link = manage();
    expect(link.tagName).toBe('A');
    expect(link.className).toContain('hub-btn');
    expect(link.getAttribute('href')).toBe('/services/canvas');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.querySelector('svg')).not.toBeNull();
    const copy = screen.getByLabelText('workspacePage.services.copyEndpointFor:canvas');
    expect(link.previousElementSibling).toBe(copy);
    // The administrator's URL never reaches the markup.
    expect(document.body.innerHTML).not.toContain('canvas.example.com/account');
  });

  it('is absent when the link is unset or unsafe', async () => {
    await mountPage(canvas({ readiness: null, manageUrl: 'javascript:alert(1)' }));
    expect(screen.queryByText('workspacePage.actions.manageAccount')).toBeNull();
  });
});

describe('Re-check', () => {
  it('asks the server to bypass its cache and shows the new state', async () => {
    await mountPage(canvas());
    mockServers.mockImplementation(() =>
      Promise.resolve([JSON.parse(JSON.stringify(canvas({ readiness: ready })))]),
    );
    fireEvent.click(screen.getByText('workspacePage.readiness.recheck'));
    await waitFor(() => expect(mockCheck).toHaveBeenCalledWith('canvas'));
    await waitFor(() => expect(panel().getAttribute('data-state')).toBe('ready'));
  });

  it('re-checks when the window regains focus after the action was clicked', async () => {
    await mountPage(canvas());
    window.dispatchEvent(new Event('focus'));
    await act(async () => {});
    expect(mockCheck).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('readiness-action'));
    window.dispatchEvent(new Event('focus'));
    await waitFor(() => expect(mockCheck).toHaveBeenCalledTimes(1));
    // Armed once per click.
    window.dispatchEvent(new Event('focus'));
    await act(async () => {});
    expect(mockCheck).toHaveBeenCalledTimes(1);
  });

  it('re-checks after the manage link was clicked too', async () => {
    await mountPage(canvas());
    fireEvent.click(
      screen.getByRole('link', { name: 'workspacePage.actions.manageAccountFor:canvas' }),
    );
    window.dispatchEvent(new Event('focus'));
    await waitFor(() => expect(mockCheck).toHaveBeenCalledTimes(1));
  });

  it('says so when the re-check fails', async () => {
    await mountPage(canvas());
    mockCheck.mockRejectedValue(new Error('boom'));
    fireEvent.click(screen.getByText('workspacePage.readiness.recheck'));
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith('workspacePage.readiness.recheckFailed', 'error'),
    );
  });
});

describe('the readiness chip in a service row', () => {
  const row = (server: WorkspaceServer) =>
    renderToStaticMarkup(
      <WorkspaceServiceRow
        server={server}
        credentialServers={null}
        busy={false}
        onToggle={jest.fn()}
        onOpen={jest.fn()}
        onAction={jest.fn()}
      />,
    );

  it('shows the state so a problem is visible without opening the service', () => {
    const html = row(canvas());
    expect(html).toContain('data-readiness="needs_setup"');
    expect(html).toContain('workspacePage.readiness.state.needs_setup');
    expect(html).toContain('hub-status warn');
  });

  it('shows a green ready chip', () => {
    const html = row(canvas({ readiness: ready }));
    expect(html).toContain('data-readiness="ready"');
    expect(html).toContain('hub-status ok');
  });

  it('leaves the existing chip alone without readiness, or when a more important state wins', () => {
    expect(row(canvas({ readiness: null }))).not.toContain('data-readiness');
    const signin = row(
      canvas({ status: { code: 'needs_auth', message: '', action: 'connect' } as never }),
    );
    expect(signin).not.toContain('data-readiness');
  });
});

describe('the setup progress', () => {
  const progress = () => screen.queryByTestId('setup-progress');
  const step = (key: string) => progress()!.querySelector(`[data-step="${key}"]`)!;

  it('shows where the service is, with the service step current and naming its own button', async () => {
    await mountPage(canvas());
    expect(step('add').getAttribute('data-state')).toBe('done');
    expect(step('access').getAttribute('data-state')).toBe('done');
    expect(step('service').getAttribute('data-state')).toBe('current');
    expect(step('service').getAttribute('aria-current')).toBe('step');
    expect(step('service').textContent).toContain('workspacePage.setup.hint.service:canvas');
    expect(step('client').getAttribute('data-state')).toBe('todo');
    // It has no buttons of its own: the action stays the service's own button.
    expect(progress()!.querySelectorAll('button, a')).toHaveLength(0);
    expect(screen.getByTestId('readiness-action')).toBeTruthy();
  });

  it('is gone once the service is ready', async () => {
    await mountPage(canvas({ readiness: ready }));
    expect(progress()).toBeNull();
  });
});
