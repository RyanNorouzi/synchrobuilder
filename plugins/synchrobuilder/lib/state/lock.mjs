// Directory lock for the background worker (ADR-001 section 5). mkdir is atomic on every platform we target. Takeover happens
// only when the holder's pid is dead, never on heartbeat age alone, because a sleeping laptop stops heartbeats without dying.
import fs from 'node:fs';
import path from 'node:path';
import { pidAlive } from '../core/proc.mjs';
import { readJson } from '../core/fsx.mjs';

const PID_FILE = 'pid.json';
const HEARTBEAT_FILE = 'heartbeat';

export function lockHolder(lockDir) {
  const p = readJson(path.join(lockDir, PID_FILE), null);
  return p && Number.isInteger(p.pid) ? p.pid : null;
}

export function lockHeldByLive(lockDir) {
  const pid = lockHolder(lockDir);
  return pid !== null && pidAlive(pid);
}

export function ownsLock(lockDir, pid = process.pid) { return lockHolder(lockDir) === pid; }

function writeHolder(lockDir, pid) {
  fs.writeFileSync(path.join(lockDir, PID_FILE), JSON.stringify({ pid, at: new Date().toISOString() }) + '\n');
  fs.writeFileSync(path.join(lockDir, HEARTBEAT_FILE), new Date().toISOString() + '\n');
}

/** Returns { ok: true, pid, tookOver? } or { ok: false, holder, error? }. */
export function acquireLock(lockDir, pid = process.pid) {
  try { fs.mkdirSync(path.dirname(lockDir), { recursive: true }); } catch { /* reported by the mkdir below */ }
  try {
    fs.mkdirSync(lockDir);
    writeHolder(lockDir, pid);
    return { ok: true, pid };
  } catch (err) {
    if (!err || err.code !== 'EEXIST') return { ok: false, holder: null, error: err && err.message };
  }
  const holder = lockHolder(lockDir);
  if (holder !== null && holder !== pid && pidAlive(holder)) return { ok: false, holder };
  // Holder is dead, or the directory exists without a pid file (a crash between mkdir and write): take over in place.
  // Two takers can race here; the loser notices through ownsLock() before its next side effect and exits.
  try { writeHolder(lockDir, pid); return { ok: true, pid, tookOver: holder }; } catch (err) { return { ok: false, holder, error: err && err.message }; }
}

/** Refresh the heartbeat. Returns false when this pid no longer holds the lock, which the worker treats as "exit now". */
export function heartbeatLock(lockDir, pid = process.pid) {
  if (!ownsLock(lockDir, pid)) return false;
  try { fs.writeFileSync(path.join(lockDir, HEARTBEAT_FILE), new Date().toISOString() + '\n'); return true; } catch { return false; }
}

export function readHeartbeat(lockDir) {
  try { return fs.readFileSync(path.join(lockDir, HEARTBEAT_FILE), 'utf8').trim() || null; } catch { return null; }
}

export function releaseLock(lockDir, pid = process.pid) {
  if (!ownsLock(lockDir, pid)) return false;
  try { fs.rmSync(lockDir, { recursive: true, force: true }); return true; } catch { return false; }
}
