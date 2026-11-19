// One place that says "what the workspace shows may have changed". Credential saves from any
// entry point (the services list, its panel, the Connect dialog opened from the top card, a
// deep link) publish here, and the services list refetches its servers and bindings.
type Listener = () => void;

const listeners = new Set<Listener>();

export const notifyWorkspaceChanged = (): void => {
  for (const listener of [...listeners]) listener();
};

export const onWorkspaceChanged = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
