// Minimal machine fingerprint for `setup`, used until lib/doctor/fingerprint.mjs (Phase 4, doctor agent) lands.
// Probes tools by spawning `<tool> --version` with an argv (no shell) and a short timeout. Only tool names and
// version numbers are collected; no environment variable value is read. Absent tools are recorded as null.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run } from '../core/proc.mjs';
import { resolveArgv } from './exec.mjs';
import { COMPOSE_FILES } from './plan.mjs';

const PROBE_TIMEOUT_MS = 5000;
const TOOLS = ['node', 'git', 'npm', 'pnpm', 'yarn', 'corepack', 'fnm', 'volta', 'winget', 'brew', 'apt-get', 'docker'];

export function parseVersion(text) {
  const m = String(text || '').match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  return m ? m[0] : null;
}

function probe(tool, platform) {
  if (tool === 'node') return { version: process.versions.node, found: true };
  const resolved = resolveArgv([tool, '--version'], platform);
  if (!resolved) return null;
  const r = run(resolved.program, resolved.args, { timeoutMs: PROBE_TIMEOUT_MS });
  if (r.error || r.code !== 0) return null;
  return { version: parseVersion(r.stdout || r.stderr), found: true };
}

/** nvm on POSIX is a shell function, so PATH cannot see it; its install script is the only reliable trace. */
function probeNvm(platform) {
  if (platform === 'win32') {
    const r = run('nvm', ['version'], { timeoutMs: PROBE_TIMEOUT_MS });
    return r.error || r.code !== 0 ? null : { version: parseVersion(r.stdout), found: true };
  }
  const script = path.join(os.homedir(), '.nvm', 'nvm.sh');
  return fs.existsSync(script) ? { version: 'unknown', found: true } : null;
}

/** detectFingerprint({ platform }) -> { platform, tools, services, envPresent: [] }. Never throws. */
export function detectFingerprint({ platform = process.platform } = {}) {
  const tools = {};
  for (const tool of TOOLS) {
    try { tools[tool] = probe(tool, platform); } catch { tools[tool] = null; }
  }
  try { tools.nvm = probeNvm(platform); } catch { tools.nvm = null; }
  return { platform, tools, services: {}, envPresent: [], source: 'setup/detect' };
}

/** First Docker Compose file present in `cwd`, as a repo-relative name, or null. */
export function detectComposeFile(cwd) {
  for (const name of COMPOSE_FILES) if (fs.existsSync(path.join(cwd, name))) return name;
  return null;
}
