// The runner registry. Each entry is one row of the matrix.
import path from 'node:path';

export const buildRunners = ({ repoRoot, python }) => {
  const node = process.execPath;
  const dir = path.join(repoRoot, 'scripts', 'compat', 'runners');
  const runners = [
    { id: 'ts-sdk:dcr-legacy', client: 'ts-sdk', variant: 'dcr-legacy', cmd: node, args: [path.join(dir, 'ts-sdk.mjs')], env: { COMPAT_VARIANT: 'dcr-legacy' } },
    { id: 'ts-sdk:dcr-auto', client: 'ts-sdk', variant: 'dcr-auto', cmd: node, args: [path.join(dir, 'ts-sdk.mjs')], env: { COMPAT_VARIANT: 'dcr-auto' } },
    { id: 'ts-sdk:cimd-legacy', client: 'ts-sdk', variant: 'cimd-legacy', cmd: node, args: [path.join(dir, 'ts-sdk.mjs')], env: { COMPAT_VARIANT: 'cimd-legacy' } },
    { id: 'ts-sdk:cimdforced-legacy', client: 'ts-sdk', variant: 'cimdforced-legacy', cmd: node, args: [path.join(dir, 'ts-sdk.mjs')], env: { COMPAT_VARIANT: 'cimdforced-legacy' } },
    { id: 'ai-sdk:dcr', client: 'ai-sdk', variant: 'dcr', cmd: node, args: [path.join(dir, 'ai-sdk.mjs')], env: { COMPAT_VARIANT: 'dcr' } },
    { id: 'ai-sdk:cimdforced', client: 'ai-sdk', variant: 'cimdforced', cmd: node, args: [path.join(dir, 'ai-sdk.mjs')], env: { COMPAT_VARIANT: 'cimdforced' } },
  ];
  for (const variant of ['dcr', 'cimd', 'cimdforced']) {
    runners.push({ id: `inspector-cli:${variant}`, client: 'inspector-cli', variant, cmd: node, args: [path.join(dir, 'inspector-cli.mjs')], env: { COMPAT_VARIANT: variant } });
  }
  const py = (id, client, variant, script, venv) => ({
    id,
    client,
    variant,
    python: venv,
    cmd: venv === 'mcp2' ? python?.mcp2 : python?.mcp1,
    args: [path.join(dir, script)],
    env: { COMPAT_VARIANT: variant, PYTHONPATH: dir, PYTHONDONTWRITEBYTECODE: '1' },
  });
  runners.push(
    py('py-sdk-mcp1:dcr', 'py-sdk (mcp 1.x)', 'dcr', 'py_sdk.py', 'mcp1'),
    py('py-sdk-mcp1:cimd', 'py-sdk (mcp 1.x)', 'cimd', 'py_sdk.py', 'mcp1'),
    py('py-sdk-mcp1:cimdforced', 'py-sdk (mcp 1.x)', 'cimdforced', 'py_sdk.py', 'mcp1'),
    py('py-sdk-mcp2:dcr', 'py-sdk (mcp 2.x)', 'dcr', 'py_sdk.py', 'mcp2'),
    py('py-sdk-mcp2:cimd', 'py-sdk (mcp 2.x)', 'cimd', 'py_sdk.py', 'mcp2'),
    py('py-sdk-mcp2:cimdforced', 'py-sdk (mcp 2.x)', 'cimdforced', 'py_sdk.py', 'mcp2'),
    py('openai-agents-mcp1:dcr', 'openai-agents (mcp 1.x)', 'dcr', 'openai_agents_runner.py', 'mcp1'),
    py('openai-agents-mcp1:cimd', 'openai-agents (mcp 1.x)', 'cimd', 'openai_agents_runner.py', 'mcp1'),
    py('openai-agents-mcp1:cimdforced', 'openai-agents (mcp 1.x)', 'cimdforced', 'openai_agents_runner.py', 'mcp1'),
    py('openai-agents-mcp2:dcr', 'openai-agents (mcp 2.x)', 'dcr', 'openai_agents_runner.py', 'mcp2'),
    py('openai-agents-mcp2:cimd', 'openai-agents (mcp 2.x)', 'cimd', 'openai_agents_runner.py', 'mcp2'),
    py('openai-agents-mcp2:cimdforced', 'openai-agents (mcp 2.x)', 'cimdforced', 'openai_agents_runner.py', 'mcp2'),
    py('langchain-mcp1:dcr', 'langchain-mcp-adapters (mcp 1.x)', 'dcr', 'langchain_runner.py', 'mcp1'),
    py('langchain-mcp1:cimd', 'langchain-mcp-adapters (mcp 1.x)', 'cimd', 'langchain_runner.py', 'mcp1'),
    py('langchain-mcp1:cimdforced', 'langchain-mcp-adapters (mcp 1.x)', 'cimdforced', 'langchain_runner.py', 'mcp1'),
  );
  return runners;
};
