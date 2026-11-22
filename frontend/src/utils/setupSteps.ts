import type { MyCredentialBinding, WorkspaceServer } from '../types';
import { hasCredentialSlots, isAdded, resolveServiceChip } from './workspace';

/**
 * The steps that take one service from the catalog to working in the user's AI client, in the
 * order the user does them. Every service page shows the same list, so the guidance looks the same
 * whatever the service; each step's action stays where it already lives (the header's Add button
 * and switch, the action box, the service's own setup button, Connect to AI).
 */
export type SetupStepKey = 'add' | 'enable' | 'access' | 'service' | 'client';
export type SetupStepState = 'done' | 'current' | 'todo' | 'blocked';

export interface SetupStep {
  key: SetupStepKey;
  state: SetupStepState;
  /** For `access`: whether the service takes a sign-in or credentials the user enters. */
  variant?: 'signin' | 'credentials';
}

export interface SetupProgress {
  steps: SetupStep[];
  /** Every required step is done; connecting a client is the optional last step. */
  complete: boolean;
  /** Required steps done, and how many there are. */
  done: number;
  total: number;
}

const ACCESS_CHIPS = new Set([
  'needs_signin',
  'needs_credentials',
  'credentials_outdated',
  'credentials_rejected',
]);

export const resolveSetupSteps = (
  server: WorkspaceServer,
  credentialServers: ReadonlySet<string> | null,
  binding?: Pick<MyCredentialBinding, 'stale' | 'configured'>,
): SetupProgress => {
  const { chip } = resolveServiceChip(server, credentialServers, binding);
  const blocked = chip === 'unavailable' || chip === 'contact_admin';
  const required: { key: SetupStepKey; done: boolean; variant?: SetupStep['variant'] }[] = [
    { key: 'add', done: isAdded(server) },
    { key: 'enable', done: isAdded(server) && server.selected },
  ];
  if (server.requiresPersonalCredential) {
    const slots = hasCredentialSlots(server, credentialServers);
    required.push({
      key: 'access',
      variant: slots ? 'credentials' : 'signin',
      done:
        server.credentialConfigured &&
        !binding?.stale &&
        !(slots && binding && !binding.configured) &&
        !ACCESS_CHIPS.has(chip),
    });
  }
  // Only a service that answers a readiness check has a setup of its own to finish.
  if (server.readiness) required.push({ key: 'service', done: server.readiness.state === 'ready' });

  let currentSeen = false;
  const steps: SetupStep[] = required.map(({ key, done, variant }) => {
    let state: SetupStepState = 'done';
    if (!done) {
      state = currentSeen ? 'todo' : blocked ? 'blocked' : 'current';
      currentSeen = true;
    }
    return variant ? { key, state, variant } : { key, state };
  });
  const complete = !currentSeen;
  steps.push({ key: 'client', state: complete ? 'current' : 'todo' });
  const doneCount = required.filter((step) => step.done).length;
  return { steps, complete, done: doneCount, total: required.length };
};
