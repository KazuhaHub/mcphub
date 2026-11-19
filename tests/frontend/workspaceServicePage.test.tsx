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
import WorkspaceServicePage from '../../frontend/src/pages/WorkspaceServicePage';
import WorkspacePage from '../../frontend/src/pages/WorkspacePage';
import { resetWorkspaceStore } from '../../frontend/src/hooks/useWorkspaceData';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars?.name ? `${key}:${vars.name}` : vars && 'count' in vars ? `${key}:${vars.count}` : key,
  }),
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
jest.mock('@/components/connect/ConnectCard', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/workspace/ActivityPanel', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/components/workspace/ConnectedClientsPanel', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/components/workspace/WorkspaceServicesView', () => ({
  __esModule: true,
  default: () => <div data-testid="list-stub" />,
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
  servers: ['anteater-shared', 'canvas-portal', 'needs-keys'].map((name) => ({
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
    name: 'ubc-offline',
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
  binding('ubc-offline', { configured: true, stale: true, updatedAt: '2026-11-01T10:00:00.000Z' }),
  binding('ubc-personal', { configured: true, stale: true, updatedAt: '2026-11-01T10:00:00.000Z' }),
  binding('needs-keys'),
];

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const Where: React.FC = () => {
  const location = useLocation();
  return <div data-testid="where">{location.pathname + location.search}</div>;
};
const mount = async (entry: string, state?: unknown, wait = true) => {
  render(
    <MemoryRouter
      initialEntries={[
        {
          pathname: entry.split('?')[0],
          search: entry.split('?')[1] ? `?${entry.split('?')[1]}` : '',
          state,
        },
      ]}
    >
      <Routes>
        <Route path="/workspace" element={<WorkspacePage />} />
        <Route path="/workspace/services/:name" element={<WorkspaceServicePage />} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
  if (wait) await waitFor(() => expect(mockBindings).toHaveBeenCalled());
  await act(async () => {});
};
const tabs = () =>
  within(screen.getByTestId('service-tabs'))
    .queryAllByRole('tab')
    .map((tab) => tab.id.replace('service-tab-', ''));
const selected = () =>
  within(screen.getByTestId('service-tabs'))
    .getAllByRole('tab')
    .filter((tab) => tab.getAttribute('aria-selected') === 'true')
    .map((tab) => tab.id.replace('service-tab-', ''));
const notice = () => screen.queryByTestId('service-notice');
const noticeAction = () => screen.queryByTestId('service-notice-action');

beforeEach(() => {
  resetWorkspaceStore();
  mockToast.mockReset();
  mockSave.mockReset().mockResolvedValue(undefined);
  mockRisk.mockReset().mockResolvedValue(undefined);
  mockServers.mockReset().mockImplementation(() => Promise.resolve(clone(servers)));
  mockBindings.mockReset().mockImplementation(() => Promise.resolve(clone(bindings)));
});

describe('the action box', () => {
  it('is absent when the user has nothing to do', async () => {
    await mount('/workspace/services/anteater-shared');
    expect(notice()).toBeNull();
    expect(screen.getByTestId('service-chip').getAttribute('data-chip')).toBe('ready');
  });

  it('is absent for a service that is only turned off and needs nothing', async () => {
    mockBindings.mockImplementation(() =>
      Promise.resolve([binding('anteater-personal', { configured: true })]),
    );
    await mount('/workspace/services/anteater-personal');
    expect(notice()).toBeNull();
    expect(screen.getByTestId('service-chip').getAttribute('data-chip')).toBe('not_enabled');
  });

  it.each([
    ['canvas-portal', 'needs_signin', 'signin', 'workspacePage.service.action.signin'],
    ['oauth-rejected', 'needs_signin', 'signin', 'workspacePage.service.action.signinAgain'],
    [
      'needs-keys',
      'needs_credentials',
      'credentials',
      'workspacePage.service.action.addCredentials',
    ],
    [
      'ubc-personal',
      'credentials_outdated',
      'credentials',
      'workspacePage.service.action.updateCredentials',
    ],
    // Not turned on, but the credentials are missing or outdated: say so before enabling.
    [
      'anteater-personal',
      'needs_credentials',
      'credentials',
      'workspacePage.service.action.addCredentials',
    ],
    [
      'ubc-offline',
      'credentials_outdated',
      'credentials',
      'workspacePage.service.action.updateCredentials',
    ],
  ])('for %s says %s and offers one button: %s', async (name, state, action, label) => {
    await mount(`/workspace/services/${name}?tab=overview`);
    expect(notice()!.getAttribute('data-notice')).toBe(state);
    expect(noticeAction()!.getAttribute('data-action')).toBe(action);
    expect(noticeAction()!.textContent).toBe(label);
    expect(screen.getAllByTestId('service-notice-action')).toHaveLength(1);
  });

  it('has no button for credentials while the credentials tab is already open', async () => {
    await mount('/workspace/services/ubc-personal');
    expect(selected()).toEqual(['credentials']);
    expect(notice()!.getAttribute('data-notice')).toBe('credentials_outdated');
    expect(noticeAction()).toBeNull();
  });

  it('says to contact the administrator, with no button and not the backend text', async () => {
    await mount('/workspace/services/no-access');
    expect(notice()!.textContent).toContain('workspacePage.panel.statusText.contact_admin');
    expect(notice()!.textContent).not.toContain('Not available');
    expect(noticeAction()).toBeNull();
  });

  it('gives the server message for an unavailable service, with no button', async () => {
    await mount('/workspace/services/broken');
    expect(notice()!.textContent).toContain('Connection refused');
    expect(noticeAction()).toBeNull();
  });

  it('starts the sign-in from the button', async () => {
    const { launchPersonalOAuth } = jest.requireMock('@/services/workspaceService');
    await mount('/workspace/services/canvas-portal');
    fireEvent.click(noticeAction()!);
    await waitFor(() => expect(launchPersonalOAuth).toHaveBeenCalledWith('canvas-portal'));
  });

  it('shows the link when the sign-in popup is blocked', async () => {
    const { launchPersonalOAuth } = jest.requireMock('@/services/workspaceService');
    launchPersonalOAuth.mockResolvedValueOnce({ kind: 'link', url: 'https://idp.example/auth' });
    await mount('/workspace/services/canvas-portal');
    fireEvent.click(noticeAction()!);
    const link = await within(notice()!).findByText('workspacePage.actions.openAuthorization');
    expect(link.getAttribute('href')).toBe('https://idp.example/auth');
  });

  it('shows the link handed over by the list', async () => {
    await mount('/workspace/services/canvas-portal', { authorizationUrl: 'https://idp.example/x' });
    expect(
      within(notice()!).getByText('workspacePage.actions.openAuthorization').getAttribute('href'),
    ).toBe('https://idp.example/x');
  });

  it('opens the credentials tab from the credentials button', async () => {
    await mount('/workspace/services/needs-keys?tab=overview');
    expect(selected()).toEqual(['overview']);
    fireEvent.click(noticeAction()!);
    expect(selected()).toEqual(['credentials']);
  });
});

describe('tabs', () => {
  it.each([
    ['anteater-shared', ['overview', 'permissions']],
    ['canvas-portal', ['overview', 'permissions']],
    ['anteater-personal', ['overview', 'credentials']],
    ['needs-keys', ['overview', 'credentials', 'permissions']],
  ])('%s has %j', async (name, expected) => {
    await mount(`/workspace/services/${name}`);
    expect(tabs()).toEqual(expected);
  });

  it('opens on credentials when the action is about credentials, else on the overview', async () => {
    await mount('/workspace/services/ubc-personal');
    expect(selected()).toEqual(['credentials']);
  });

  it('opens on the overview for sign-in and ready services', async () => {
    await mount('/workspace/services/canvas-portal');
    expect(selected()).toEqual(['overview']);
  });

  it('honours ?tab= when that tab applies', async () => {
    await mount('/workspace/services/anteater-shared?tab=permissions');
    expect(selected()).toEqual(['permissions']);
  });

  it('ignores ?tab= for a tab the service does not have', async () => {
    await mount('/workspace/services/anteater-shared?tab=credentials');
    expect(selected()).toEqual(['overview']);
  });

  it('moves between tabs with the arrow keys, one tab in the tab order', async () => {
    await mount('/workspace/services/needs-keys?tab=overview');
    const list = screen.getByTestId('service-tabs');
    const all = within(list).getAllByRole('tab');
    expect(all.map((tab) => tab.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
    fireEvent.keyDown(all[0], { key: 'ArrowRight' });
    expect(selected()).toEqual(['credentials']);
    expect(document.activeElement!.id).toBe('service-tab-credentials');
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(selected()).toEqual(['permissions']);
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    expect(selected()).toEqual(['overview']);
  });

  it('shows no permissions tab once the service is turned off', async () => {
    await mount('/workspace/services/anteater-shared');
    mockServers.mockImplementation(() =>
      Promise.resolve(
        clone(servers).map((s) => (s.name === 'anteater-shared' ? { ...s, selected: false } : s)),
      ),
    );
    fireEvent.click(screen.getByTestId('service-toggle'));
    await waitFor(() => expect(mockSave).toHaveBeenCalledWith('anteater-shared', false));
    await waitFor(() => expect(tabs()).toEqual(['overview']));
  });
});

describe('the overview', () => {
  it('shows the title, the description and the tool count', async () => {
    await mount('/workspace/services/anteater-shared');
    expect(screen.getByTestId('service-title').textContent).toBe('anteater-shared');
    expect(screen.getByTestId('service-description').textContent).toBe(DESCRIPTION);
    expect(screen.getByTestId('service-tools').textContent).toBe(
      'workspacePage.services.toolCount:20',
    );
  });

  it('says tools are visible after sign-in', async () => {
    await mount('/workspace/services/canvas-portal');
    expect(screen.getByTestId('service-tools').textContent).toBe(
      'workspacePage.panel.toolsAfterSignIn',
    );
  });

  it('offers connect, copy and manage account; connect is scoped to this service', async () => {
    await mount('/workspace/services/anteater-shared');
    expect(
      screen.getByLabelText('workspacePage.services.copyEndpointFor:anteater-shared'),
    ).toBeTruthy();
    expect(document.querySelector('a[href="/services/anteater-shared"]')).not.toBeNull();
    fireEvent.click(screen.getByLabelText('connect.rowActionFor:anteater-shared'));
    expect(screen.getByTestId('connect-dialog-stub').getAttribute('data-service')).toBe(
      'anteater-shared',
    );
  });

  it('does not repeat the status, the permission control or the credentials form', async () => {
    await mount('/workspace/services/needs-keys?tab=overview');
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });
});

describe('the credentials tab', () => {
  it('shows only this service form, without the repeated warning, tag or hints', async () => {
    await mount('/workspace/services/ubc-personal');
    await screen.findByLabelText('ubc-personal');
    const text = document.body.textContent!;
    expect(text).not.toContain('anteater-personal');
    expect(text).not.toContain('credentials.staleNotice');
    expect(text).not.toContain('credentials.outdatedStatus');
    expect(text).not.toContain('credentials.replaceHint');
    // The form is open, ready to fill; the last update is small text.
    expect(document.querySelector('input[type="password"]')).not.toBeNull();
    expect(screen.getByText('credentials.updatedAt', { exact: false })).toBeTruthy();
    expect(screen.getByText('credentials.replace')).toBeTruthy();
    expect(screen.getByText('credentials.cancel')).toBeTruthy();
    expect(screen.getByText('credentials.copyFrom')).toBeTruthy();
  });

  it('leaves the action box after a save', async () => {
    await mount('/workspace/services/needs-keys');
    await screen.findByLabelText('needs-keys');
    mockServers.mockImplementation(() =>
      Promise.resolve(
        clone(servers).map((s) =>
          s.name === 'needs-keys'
            ? { ...s, status: { code: 'available', message: '', action: null } }
            : s,
        ),
      ),
    );
    fireEvent.change(document.querySelector('input[type="password"]') as HTMLInputElement, {
      target: { value: 'secret-value' },
    });
    await act(async () => {
      fireEvent.click(screen.getByText('credentials.save'));
    });
    await waitFor(() => expect(notice()).toBeNull());
    expect(screen.getByTestId('service-chip').getAttribute('data-chip')).toBe('ready');
  });
});

describe('the permissions tab', () => {
  it('shows the level control with one short line, and saves through the existing call', async () => {
    await mount('/workspace/services/anteater-shared?tab=permissions');
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    expect(document.body.textContent!.split('workspacePage.risk.explanation')).toHaveLength(2);
    fireEvent.click(document.querySelector('[data-risk-level="write"]')!);
    await waitFor(() => expect(mockRisk).toHaveBeenCalledWith('anteater-shared', 'write'));
  });
});

describe('the switch on the page', () => {
  it('turns the service on through the existing call', async () => {
    await mount('/workspace/services/anteater-personal');
    const toggle = screen.getByTestId('service-toggle');
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(toggle);
    await waitFor(() => expect(mockSave).toHaveBeenCalledWith('anteater-personal', true));
  });
});

describe('a service that does not exist', () => {
  it('says so and links back to the workspace', async () => {
    await mount('/workspace/services/nope');
    const box = screen.getByTestId('not-found');
    expect(box.textContent).toContain('workspacePage.service.notFound');
    expect(within(box).getByRole('link').getAttribute('href')).toBe('/workspace');
  });
});

describe('the back link', () => {
  it('goes to the workspace', async () => {
    await mount('/workspace/services/anteater-shared');
    fireEvent.click(screen.getByText('workspacePage.service.back'));
    expect(screen.getByTestId('where').textContent).toBe('/workspace');
  });
});

describe('old links', () => {
  it('sends /workspace?service= to the service page', async () => {
    await mount('/workspace?service=canvas-portal');
    expect(screen.getByTestId('where').textContent).toBe('/workspace/services/canvas-portal');
  });

  it('sends /workspace?credentials= to the credentials tab', async () => {
    await mount('/workspace?credentials=needs-keys');
    expect(screen.getByTestId('where').textContent).toBe(
      '/workspace/services/needs-keys?tab=credentials',
    );
    expect(selected()).toEqual(['credentials']);
  });

  it.each(['clients', 'activity'])('sends /workspace?tab=%s to its own page', async (tab) => {
    await mount(`/workspace?tab=${tab}`, undefined, false);
    expect(screen.getByTestId('where').textContent).toBe(`/workspace/${tab}`);
  });

  it('keeps the plain workspace page when there is no service', async () => {
    await mount('/workspace', undefined, false);
    expect(screen.getByTestId('where').textContent).toBe('/workspace');
    expect(screen.getByTestId('list-stub')).toBeTruthy();
  });
});
