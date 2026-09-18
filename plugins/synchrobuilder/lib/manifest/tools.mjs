// Which tools are on PATH and which version they report. Shared by init (detection) and doctor (fingerprint).
// Everything spawns with an argv array and a short timeout. On Windows, npm/pnpm/yarn are .cmd shims that Node refuses to
// spawn without a shell, so we run their JavaScript entry points with the current node binary instead (ADR-004 consequences).
import fs from 'node:fs';
import path from 'node:path';
import { run, scrubbedEnv } from '../core/proc.mjs';

const PROBE_TIMEOUT_MS = 8000;

/** First match of "major.minor[.patch]" in a tool's output, or null. */
export function parseVersion(text) {
  const m = String(text || '').match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  return m ? m[0] : null;
}

/** Locate a program on PATH the way the OS would (PATHEXT on Windows). Returns the absolute path or null. Never spawns anything. */
export function findOnPath(name, env = process.env) {
  const dirs = String(env.PATH || env.Path || '').split(path.delimiter).filter(Boolean);
  const exts = process.platform === 'win32' ? String(env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').map((e) => e.toLowerCase()) : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext);
      try { if (fs.statSync(candidate).isFile()) return candidate; } catch { /* keep looking */ }
    }
  }
  return null;
}

/** npm's JavaScript entry next to the running node binary, or null when this node was installed without npm. */
export function npmCliPath(execPath = process.execPath) {
  const base = path.dirname(execPath);
  const candidates = [
    path.join(base, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(base, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  return candidates.find((c) => { try { return fs.statSync(c).isFile(); } catch { return false; } }) || null;
}

/** Corepack's JavaScript entry next to the running node binary, or null. */
export function corepackPath(execPath = process.execPath) {
  const base = path.dirname(execPath);
  const candidates = [
    path.join(base, 'node_modules', 'corepack', 'dist', 'corepack.js'),
    path.join(base, '..', 'lib', 'node_modules', 'corepack', 'dist', 'corepack.js'),
  ];
  return candidates.find((c) => { try { return fs.statSync(c).isFile(); } catch { return false; } }) || null;
}

function defaultProbe(program, args, opts = {}) { return run(program, args, { timeoutMs: PROBE_TIMEOUT_MS, ...opts }); }

/**
 * Version of a tool: { present, version, via }. `present` can be true with `version` null when the tool exists on PATH but
 * could not be spawned directly (Windows .cmd shims without a JavaScript entry point we know).
 * `probe(program, args, opts)` is injectable so tests never spawn real tools.
 */
export function toolVersion(name, { probe = defaultProbe, env = process.env, platform = process.platform } = {}) {
  const onPath = findOnPath(name, env);
  const node = process.execPath;
  const tryRun = (program, args, opts, via) => {
    const r = probe(program, args, opts);
    if (!r || r.error || r.code !== 0) return null;
    const version = parseVersion(r.stdout) || parseVersion(r.stderr);
    return version ? { present: true, version, via } : null;
  };
  if (name === 'npm') {
    const cli = npmCliPath();
    const hit = cli && tryRun(node, [cli, '--version'], {}, 'npm-cli.js');
    if (hit) return hit;
  }
  if ((name === 'pnpm' || name === 'yarn') && platform === 'win32') {
    // Corepack answers offline when the version is already cached; the env keeps it from downloading or prompting.
    const shim = corepackPath();
    const opts = { env: scrubbedEnv({ COREPACK_ENABLE_NETWORK: '0', COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' }) };
    const hit = shim && tryRun(node, [shim, name, '--version'], opts, 'corepack');
    if (hit) return hit;
    return { present: !!onPath, version: null, via: onPath ? 'path-only' : null };
  }
  const direct = tryRun(name, ['--version'], {}, 'path');
  if (direct) return direct;
  return { present: !!onPath, version: null, via: onPath ? 'path-only' : null };
}
