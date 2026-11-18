// Preloaded into the Inspector CLI process (NODE_OPTIONS=--import). The CLI refuses to start an
// interactive OAuth login without a TTY unless browser auto-open is enabled, and auto-open launches
// the machine's real browser through child_process.spawn (the `open` package). The harness is the
// browser here, so any attempt to launch one is swallowed.
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';

const original = childProcess.spawn;
const LAUNCHERS = /(^|[\\/])(open|xdg-open|wslview|gio|gnome-open|kde-open|explorer\.exe|cmd\.exe|powershell(\.exe)?)$/i;

childProcess.spawn = function patchedSpawn(command, ...rest) {
  if (typeof command === 'string' && LAUNCHERS.test(command)) {
    process.stderr.write(`[compat] suppressed browser launch: ${command}\n`);
    const fake = new EventEmitter();
    fake.unref = () => {};
    fake.kill = () => true;
    fake.stdout = fake.stderr = null;
    setImmediate(() => fake.emit('spawn'));
    setImmediate(() => fake.emit('exit', 0, null));
    return fake;
  }
  return original.call(this, command, ...rest);
};
syncBuiltinESMExports();
