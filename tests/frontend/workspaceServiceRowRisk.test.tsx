import '../utils/textEncoderPolyfill';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { WorkspaceServer } from '../../frontend/src/types';
import WorkspaceServicePage from '../../frontend/src/pages/WorkspaceServicePage';
import { seedWorkspaceStore } from '../../frontend/src/hooks/useWorkspaceData';

jest.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast: jest.fn() }) }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && 'count' in options ? `${key}:${options.count}` : key,
  }),
}));

const server = (extra: Partial<WorkspaceServer> = {}): WorkspaceServer => ({
  name: 'notes',
  selected: true,
  enabled: true,
  toolCount: 4,
  riskCeiling: 'read',
  riskCeilingIsDefault: false,
  riskCounts: { read: 4, write: 3, external: 2 },
  maxAllowedRisk: 'external',
  annotationsTrusted: true,
  requiresPersonalCredential: false,
  credentialConfigured: true,
  status: { code: 'available', message: 'ok', action: null },
  ...extra,
});

const page = (workspaceServer: WorkspaceServer, tab: string) => {
  seedWorkspaceStore({ servers: [workspaceServer] });
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: [`/workspace/services/${workspaceServer.name}?tab=${tab}`] },
      createElement(
        Routes,
        null,
        createElement(Route, {
          path: '/workspace/services/:name',
          element: createElement(WorkspaceServicePage),
        }),
      ),
    ),
  );
};
// Both tabs a service page can show about the service: its overview and its permission control.
const render = (workspaceServer: WorkspaceServer) =>
  page(workspaceServer, 'overview') + page(workspaceServer, 'permissions');

const radios = (html: string) =>
  [...html.matchAll(/<button[^>]*role="radio"[^>]*>/g)].map((match) => match[0]);

describe('the tool risk control in a service page', () => {
  it('offers three options with the number of tools at each level', () => {
    const html = render(server());
    const options = radios(html);
    expect(options).toHaveLength(3);
    expect(options.map((tag) => /data-risk-level="(\w+)"/.exec(tag)![1])).toEqual([
      'read',
      'write',
      'external',
    ]);
    expect(html).toContain('workspacePage.risk.level.read.label');
    expect(html).toContain('workspacePage.risk.level.write.label');
    expect(html).toContain('workspacePage.risk.level.external.label');
    for (const count of ['4', '3', '2'])
      expect(html).toContain(`workspacePage.services.toolCount:${count}`);
  });

  it('marks the chosen level and reads read only by default', () => {
    const options = radios(render(server()));
    expect(options.map((tag) => tag.includes('aria-checked="true"'))).toEqual([true, false, false]);
    expect(
      radios(render(server({ riskCeiling: 'external' }))).map((tag) =>
        tag.includes('aria-checked="true"'),
      ),
    ).toEqual([false, false, true]);
  });

  it('disables the options above the administrator’s cap and says why', () => {
    const html = render(server({ maxAllowedRisk: 'write' }));
    expect(radios(html).map((tag) => tag.includes('disabled'))).toEqual([false, false, true]);
    expect(html).toContain('title="workspacePage.risk.aboveCap"');
  });

  it('explains the control and tells the user how many tools their choice hides', () => {
    const html = render(server());
    expect(html).toContain('workspacePage.risk.explanation');
    expect(html).toContain('workspacePage.risk.hiddenNotice:5');
    expect(render(server({ riskCeiling: 'external' }))).not.toContain(
      'workspacePage.risk.hiddenNotice',
    );
  });

  it('is shown only for a service in the workspace, and the explanation only once', () => {
    const off = render(server({ selected: false }));
    expect(radios(off)).toHaveLength(0);
    // Without the switch on there is no permissions tab to show.
    expect(off).not.toContain('service-tab-permissions');
    const html = render(server());
    expect(html.split('workspacePage.risk.explanation').length).toBe(2);
  });

  it('keeps the existing tool count, which now counts only what the ceiling allows', () => {
    expect(render(server())).toContain('workspacePage.services.toolCount:4');
  });

  it('says to connect, rather than showing zero tools, when the tools are not known', () => {
    const html = render(server({ toolCount: null, riskCounts: null }));
    expect(html).toContain('workspacePage.panel.toolsAfterSignIn');
    expect(html).not.toContain('workspacePage.risk.connectToSee');
    expect(html).not.toContain('workspacePage.services.toolCount');
    expect(html).not.toContain('workspacePage.risk.hiddenNotice');
    expect(radios(html)).toHaveLength(3);
  });

  it('does not say to connect when the user is connected but their tools are not listed yet', () => {
    const html = render(
      server({
        toolCount: null,
        riskCounts: null,
        requiresPersonalCredential: true,
        credentialConfigured: true,
      }),
    );
    expect(html.split('workspacePage.risk.connectedPending')).toHaveLength(2);
    expect(html).not.toContain('workspacePage.panel.toolsAfterSignIn');
    expect(html).not.toContain('workspacePage.risk.connectToSee');
  });

  it.each([
    ['disabled', { enabled: false }],
    ['paused', { status: { code: 'paused', message: 'paused', action: null } }],
    ['failing', { status: { code: 'error', message: 'down', action: 'retry_later' } }],
  ] as Array<[string, Partial<WorkspaceServer>]>)(
    'keeps the status-driven text for a %s connected service',
    (_label, extra) => {
      const html = render(
        server({
          toolCount: null,
          riskCounts: null,
          requiresPersonalCredential: true,
          credentialConfigured: true,
          ...extra,
        }),
      );
      expect(html).not.toContain('workspacePage.risk.connectedPending');
    },
  );

  it('still says to connect when the personal credential is missing', () => {
    const html = render(
      server({
        toolCount: null,
        riskCounts: null,
        requiresPersonalCredential: true,
        credentialConfigured: false,
      }),
    );
    expect(html).not.toContain('workspacePage.risk.connectToSee');
    expect(html).not.toContain('workspacePage.risk.connectedPending');
  });

  it('tells the user when a level is only the administrator’s default', () => {
    expect(render(server({ riskCeilingIsDefault: true }))).toContain(
      'workspacePage.risk.defaultNote',
    );
    expect(render(server())).not.toContain('workspacePage.risk.defaultNote');
  });

  it('warns that tools of a service a non-admin runs are not verified', () => {
    expect(render(server({ annotationsTrusted: false }))).toContain(
      'workspacePage.risk.untrustedHint',
    );
    expect(render(server())).not.toContain('workspacePage.risk.untrustedHint');
  });
});

describe('the management link in a service page', () => {
  it('is a button labelled with the service name that opens the stable link', () => {
    const html = render(server({ manageUrl: 'https://example.com/account/token' }));
    // The hub link is opened on click; the administrator's URL never reaches the markup.
    expect(html).not.toContain('example.com/account/token');
    expect(html).not.toContain('href="/services/notes"');
    expect(html).toMatch(
      /<button[^>]*class="hub-btn"[^>]*aria-label="workspacePage.actions.manageAccountFor"/,
    );
    expect(html).toContain('workspacePage.actions.manageAccount');
  });

  it('renders nothing when the link is unset or unsafe', () => {
    expect(render(server())).not.toContain('workspacePage.actions.manageAccount');
    const unsafe = render(server({ manageUrl: 'javascript:alert(1)' }));
    expect(unsafe).not.toContain('javascript:');
    expect(unsafe).not.toContain('workspacePage.actions.manageAccount');
  });
});
