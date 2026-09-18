// Process helpers: argv-only spawning (no shell, ever), bounded by time, with a scrubbed environment.
import { spawnSync, spawn } from 'node:child_process';

const STRIP = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_NAMESPACE', 'GIT_COMMON_DIR'];

export function scrubbedEnv(extra = {}) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!STRIP.includes(k) && !k.startsWith('OTEL_')) env[k] = v;
  return Object.assign(env, {
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'never',
    SSH_ASKPASS_REQUIRE: 'never',
    GIT_CONFIG_NOSYSTEM: env.GIT_CONFIG_NOSYSTEM || '',
  }, extra);
}

/** Run a program with an argument vector. Returns { code, stdout, stderr, timedOut }. Never throws. */
export function run(program, args, { cwd, timeoutMs = 20000, env, input, maxBuffer = 16 * 1024 * 1024 } = {}) {
  try {
    const r = spawnSync(program, args, { cwd, env: env || scrubbedEnv(), input, encoding: 'utf8', timeout: timeoutMs, maxBuffer, windowsHide: true });
    return { code: r.status === null ? -1 : r.status, stdout: r.stdout || '', stderr: r.stderr || '', timedOut: r.error && r.error.code === 'ETIMEDOUT', error: r.error ? r.error.message : null };
  } catch (err) {
    return { code: -1, stdout: '', stderr: '', timedOut: false, error: err.message };
  }
}

export function git(args, opts = {}) { return run('git', args, { timeoutMs: 20000, ...opts }); }

/** Start a Node script that outlives this process. Returns the pid or null. */
export function spawnDetached(scriptPath, args = [], { cwd, env } = {}) {
  try {
    const child = spawn(process.execPath, [scriptPath, ...args], { cwd, env: env || scrubbedEnv(), detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
    return child.pid || null;
  } catch { return null; }
}

export function pidAlive(pid) {
  if (!pid || !Number.isInteger(pid)) return false;
  try { process.kill(pid, 0); return true; } catch (err) { return err && err.code === 'EPERM'; }
}
