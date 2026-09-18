// A fingerprint of this machine: what is installed, what is reachable, which environment variable NAMES are set.
// Values are never read. Recorded on a machine where the project works, compared on one where it does not.
import os from 'node:os';
import net from 'node:net';
import { toolVersion, findOnPath } from '../manifest/tools.mjs';
import { currentOs } from '../manifest/schema.mjs';

export const TOOLS = Object.freeze(['node', 'git', 'npm', 'pnpm', 'yarn', 'bun', 'python3', 'python', 'docker', 'make']);

/** Can something accept a TCP connection on this port? Used to tell "Postgres is running" from "Postgres is installed". */
export function probePort(port, { host = '127.0.0.1', timeoutMs = 500 } = {}) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (reachable) => { if (!settled) { settled = true; try { socket.destroy(); } catch { /* already closed */ } resolve(reachable); } };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    try { socket.connect(port, host); } catch { done(false); }
  });
}

export async function fingerprint(manifest = null, { probe, platform = process.platform, env = process.env } = {}) {
  const tools = {};
  for (const name of TOOLS) {
    const probed = toolVersion(name, { probe, env, platform });
    if (probed && probed.present) tools[name] = { version: probed.version || null, via: probed.via || null, path: findOnPath(name, env) || null };
  }
  const services = [];
  for (const s of (manifest && manifest.services) || []) {
    if (!Number.isInteger(s.port)) { services.push({ name: s.name, port: null, reachable: null }); continue; }
    services.push({ name: s.name, port: s.port, reachable: await probePort(s.port) });
  }
  const envNames = [];
  for (const e of (manifest && manifest.env) || []) if (Object.prototype.hasOwnProperty.call(env, e.name)) envNames.push(e.name);
  return {
    recordedAt: new Date().toISOString(),
    os: currentOs(platform),
    platform,
    arch: os.arch(),
    release: os.release(),
    node: process.version,
    tools,
    services,
    envNamesSet: envNames,
    // Names only. A value never enters the fingerprint, so the file is safe to commit.
    envNamesMissing: ((manifest && manifest.env) || []).filter((e) => !Object.prototype.hasOwnProperty.call(env, e.name)).map((e) => e.name),
  };
}
