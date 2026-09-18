// Runs one plan step with an argument vector and no shell (ADR-004 Consequences).
// On Windows the npm/npx/pnpm/yarn/corepack commands are .cmd shims that child_process refuses to spawn without a
// shell, so they are resolved to their JavaScript entry points next to node.exe and run with process.execPath.
// If that resolution fails the step is downgraded to "manual" with the exact command string, never run through cmd.exe.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { run, scrubbedEnv } from '../core/proc.mjs';

const NPM_ENTRIES = { npm: ['npm', 'bin', 'npm-cli.js'], npx: ['npm', 'bin', 'npx-cli.js'] };
const COREPACK_ENTRY = ['corepack', 'dist', 'corepack.js'];
const COREPACK_MANAGED = new Set(['pnpm', 'pnpx', 'yarn', 'yarnpkg']);
const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;

/** Quote an argv for humans (and for pasting into a shell) without ever executing it. */
export function formatCommand(argv) {
  return (argv || []).map((a) => (/^[A-Za-z0-9_@%+=:,./\\-]+$/.test(a) ? a : `"${String(a).replace(/(["\\])/g, '\\$1')}"`)).join(' ');
}

/**
 * resolvePackageManager(name, platform, { execPath, exists }) -> { program, argsPrefix } | null.
 * POSIX runs the program by name. Windows maps the known shims to `node <entry.js>`; null means the entry file is
 * missing (for example a Node build without Corepack) and the caller must fall back to a manual step.
 */
export function resolvePackageManager(name, platform = process.platform, { execPath = process.execPath, exists = fs.existsSync } = {}) {
  if (name === 'node') return { program: execPath, argsPrefix: [] };
  if (platform !== 'win32') return { program: name, argsPrefix: [] };
  const modules = path.join(path.dirname(execPath), 'node_modules');
  if (NPM_ENTRIES[name]) {
    const entry = path.join(modules, ...NPM_ENTRIES[name]);
    return exists(entry) ? { program: execPath, argsPrefix: [entry] } : null;
  }
  if (name === 'corepack' || COREPACK_MANAGED.has(name)) {
    const entry = path.join(modules, ...COREPACK_ENTRY);
    if (!exists(entry)) return null;
    return { program: execPath, argsPrefix: name === 'corepack' ? [entry] : [entry, name] };
  }
  return { program: name, argsPrefix: [] };
}

/** Resolve a whole argv: { program, args } or null when the first word cannot be spawned without a shell. */
export function resolveArgv(argv, platform = process.platform, opts = {}) {
  if (!Array.isArray(argv) || !argv.length || typeof argv[0] !== 'string') return null;
  const r = resolvePackageManager(argv[0], platform, opts);
  return r ? { program: r.program, args: [...r.argsPrefix, ...argv.slice(1)] } : null;
}

function markManual(step, reason) {
  const text = `${formatCommand(step.command)}  (${reason})`;
  step.manual = text;
  step.command = null;
  step.needsConsent = false;
  return { ok: false, code: null, output: text, manual: true };
}

function looksUnspawnable(result) {
  return Boolean(result.error) && /ENOENT|EACCES|EINVAL|UNKNOWN/.test(result.error);
}

/**
 * runStep(step, { cwd, onOutput, platform, timeoutMs }) -> { ok, code, output, manual }.
 * Synchronous under the hood (proc.run), so `onOutput` receives the collected output once the program exits.
 */
export function runStep(step, { cwd, onOutput, platform = process.platform, timeoutMs = DEFAULT_TIMEOUT_MS, execPath, exists } = {}) {
  if (!step || !Array.isArray(step.command)) return { ok: false, code: null, output: step && step.manual ? step.manual : 'nothing to run', manual: true };
  const resolved = resolveArgv(step.command, platform, { execPath, exists });
  if (!resolved) return markManual(step, `could not find the ${step.command[0]} entry point next to ${execPath || process.execPath}; run this yourself`);
  const r = run(resolved.program, resolved.args, { cwd, timeoutMs, maxBuffer: 64 * 1024 * 1024 });
  const output = [r.stdout, r.stderr].filter(Boolean).join('\n').trimEnd();
  if (looksUnspawnable(r)) return markManual(step, `${r.error}; on Windows a .cmd shim needs a shell, so run this yourself`);
  if (typeof onOutput === 'function' && output) onOutput(output);
  if (r.timedOut) return { ok: false, code: r.code, output: `${output}\n[timed out after ${Math.round(timeoutMs / 1000)}s]`.trim(), manual: false };
  return { ok: r.code === 0, code: r.code, output: r.error && !output ? r.error : output, manual: false };
}

/**
 * spawnStep(step, { cwd, onOutput, platform }) -> { pid, stop(), exited } | { manual: true, output }.
 * For long-running `start` commands: streams output as it arrives and lets the caller stop the process after the
 * health check. Only the direct child is stopped; grandchildren a dev server forks may outlive it.
 */
export function spawnStep(step, { cwd, onOutput, platform = process.platform, execPath, exists } = {}) {
  if (!step || !Array.isArray(step.command)) return { manual: true, output: step && step.manual ? step.manual : 'nothing to run' };
  const resolved = resolveArgv(step.command, platform, { execPath, exists });
  if (!resolved) return { manual: true, ...markManual(step, `could not find the ${step.command[0]} entry point; start it yourself`) };
  let child;
  try {
    child = spawn(resolved.program, resolved.args, { cwd, env: scrubbedEnv(), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  } catch (err) {
    return { manual: true, ...markManual(step, `${err.message}; start it yourself`) };
  }
  const state = { code: null, error: null };
  const exited = new Promise((resolve) => {
    child.on('error', (err) => { state.error = err.message; resolve(state); });
    child.on('exit', (code) => { state.code = code; resolve(state); });
  });
  const forward = (chunk) => { if (typeof onOutput === 'function') onOutput(String(chunk).trimEnd()); };
  child.stdout.on('data', forward);
  child.stderr.on('data', forward);
  return { pid: child.pid || null, exited, state, stop() { try { child.kill(); } catch { /* already gone */ } } };
}
