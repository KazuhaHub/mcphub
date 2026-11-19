// One place that says "what the workspace shows may have changed". Credential saves, sign-ins,
// selection and permission changes from any entry point (the services list, its panel, the
// Connect dialog, a deep link) publish here, and everything that shows workspace data (the
// services list and the Connect card) refetches. `origin` lets a publisher skip its own reload.
type Listener = (origin?: unknown) => void;

const listeners = new Set<Listener>();

export const notifyWorkspaceChanged = (origin?: unknown): void => {
  for (const listener of [...listeners]) listener(origin);
};

export const onWorkspaceChanged = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
