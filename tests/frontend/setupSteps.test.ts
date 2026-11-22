import { resolveSetupSteps } from '@/utils/setupSteps';
import type { WorkspaceReadiness, WorkspaceServer } from '@/types';

const readiness = (state: WorkspaceReadiness['state']): WorkspaceReadiness => ({
  state,
  summary: null,
  action: null,
  expiresAt: null,
  checkedAt: '2026-11-22T00:00:00.000Z',
});
const server = (extra: Partial<WorkspaceServer> = {}): WorkspaceServer =>
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
    readiness: null,
    status: { code: 'available', message: '', action: null },
    ...extra,
  }) as WorkspaceServer;
const states = (s: WorkspaceServer, binding?: { stale: boolean; configured: boolean }) =>
  resolveSetupSteps(s, null, binding).steps.map((step) => `${step.key}:${step.state}`);

describe('resolveSetupSteps', () => {
  it('lists the same steps in the same order, with only the first unfinished one current', () => {
    expect(states(server({ added: false, selected: false, credentialConfigured: false }))).toEqual([
      'add:current',
      'enable:todo',
      'access:todo',
      'client:todo',
    ]);
    expect(states(server({ selected: false }))).toEqual([
      'add:done',
      'enable:current',
      'access:done',
      'client:todo',
    ]);
  });

  it('asks for a sign-in or for credentials depending on what the service takes', () => {
    const signin = resolveSetupSteps(
      server({
        credentialConfigured: false,
        status: { code: 'needs_auth', message: '', action: 'connect' },
      }),
      null,
    );
    expect(signin.steps[2]).toEqual({ key: 'access', state: 'current', variant: 'signin' });
    const slots = resolveSetupSteps(server({ hasCredentialSlots: true }), null, {
      stale: true,
      configured: true,
    });
    expect(slots.steps[2]).toEqual({ key: 'access', state: 'current', variant: 'credentials' });
  });

  it('skips the access step for a shared service and the service step without a readiness check', () => {
    expect(states(server({ requiresPersonalCredential: false }))).toEqual([
      'add:done',
      'enable:done',
      'client:current',
    ]);
    expect(resolveSetupSteps(server(), null).complete).toBe(true);
  });

  it('keeps the setup open until the service itself says it is ready', () => {
    const pending = resolveSetupSteps(server({ readiness: readiness('needs_setup') }), null);
    expect(pending.steps.map((s) => `${s.key}:${s.state}`)).toEqual([
      'add:done',
      'enable:done',
      'access:done',
      'service:current',
      'client:todo',
    ]);
    expect(pending.complete).toBe(false);
    expect([pending.done, pending.total]).toEqual([3, 4]);
    expect(resolveSetupSteps(server({ readiness: readiness('ready') }), null).complete).toBe(true);
  });

  it('marks the current step blocked when only an administrator can fix it', () => {
    const paused = resolveSetupSteps(
      server({
        credentialConfigured: false,
        status: { code: 'paused', message: '', action: null },
      }),
      null,
    );
    expect(paused.steps.find((s) => s.key === 'access')!.state).toBe('blocked');
  });
});
