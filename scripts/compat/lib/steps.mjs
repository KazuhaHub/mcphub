// Step vocabulary shared by every runner. A runner records each step as it goes; once a step has
// failed, later steps that depend on it are recorded as `skip` rather than run.
export const STEPS = ['discovery', 'register', 'login', 'list', 'call', 'refresh'];

export const STEP_TITLES = {
  discovery: '1 discovery',
  register: '2a register',
  login: '2b login',
  list: '3 list',
  call: '4 call',
  refresh: '5 refresh',
};

export const createRecorder = (client) => {
  const result = {
    client: client.name,
    variant: client.variant ?? '',
    versions: client.versions ?? {},
    steps: {},
    protocol: null,
    notes: [],
  };
  let blocked;
  return {
    result,
    async step(name, fn) {
      if (blocked) {
        result.steps[name] = { status: 'skip', detail: `blocked by failed step "${blocked}"` };
        return undefined;
      }
      try {
        const out = await fn();
        const detail = typeof out === 'string' ? out : (out?.detail ?? '');
        result.steps[name] = { status: out?.status ?? 'pass', detail };
        return out;
      } catch (error) {
        blocked = name;
        const message = error instanceof Error ? error.message : String(error);
        result.steps[name] = { status: 'fail', detail: message.slice(0, 600) };
        return undefined;
      }
    },
    mark(name, status, detail) {
      result.steps[name] = { status, detail };
    },
    block(name) {
      blocked = name;
    },
    note(text) {
      result.notes.push(text);
    },
  };
};

export const emitResult = (result) => {
  process.stdout.write(`\n@@COMPAT_RESULT@@${JSON.stringify(result)}\n`);
};
