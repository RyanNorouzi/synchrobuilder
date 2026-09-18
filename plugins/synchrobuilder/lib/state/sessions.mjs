// Session files and the branch a checkout is on, by file reads only (ADR-001 section 6).
// A session file's pid is the Claude Code process the hook ran under (process.ppid of the hook), which is what liveness means here.
import fs from 'node:fs';
import path from 'node:path';
import { paths } from './layout.mjs';
import { readJson, listFiles, readText } from '../core/fsx.mjs';
import { pidAlive } from '../core/proc.mjs';
import { validBranch } from '../core/schema.mjs';

export function listSessions(checkoutDir) {
  const out = [];
  for (const f of listFiles(paths.checkout(checkoutDir).sessions, (n) => n.endsWith('.json'))) {
    const s = readJson(f, null);
    if (s && typeof s === 'object' && typeof s.sessionId === 'string') out.push(s);
  }
  return out;
}

/** Sessions whose Claude process is still alive and that have not written a closed marker. */
export function liveSessions(checkoutDir) {
  return listSessions(checkoutDir).filter((s) => !s.closed && pidAlive(s.pid));
}

/** The most recently seen live session, or null. Its branch is the best guess for presence. */
export function latestLiveSession(checkoutDir) {
  const live = liveSessions(checkoutDir);
  live.sort((a, b) => Date.parse(b.lastSeenAt || 0) - Date.parse(a.lastSeenAt || 0));
  return live[0] || null;
}

/** The branch a git dir has checked out, read from its HEAD file without git. Pass the work tree's own git dir: a linked
 *  worktree keeps its own HEAD there, and for a plain checkout it is the common dir. Detached HEAD yields a short sha. */
export function readBranch(gitDir) {
  const head = readText(path.join(gitDir, 'HEAD'), '').trim();
  if (!head) return null;
  const m = head.match(/^ref:\s*refs\/heads\/(.+)$/);
  if (m) return validBranch(m[1]);
  return /^[0-9a-f]{40,64}$/i.test(head) ? head.slice(0, 12) : null;
}

/** Remove closed or dead session files older than `maxAgeMs` so a busy checkout does not accumulate them. Worker housekeeping. */
export function pruneSessions(checkoutDir, { maxAgeMs = 24 * 3600 * 1000, now = Date.now() } = {}) {
  let removed = 0;
  for (const f of listFiles(paths.checkout(checkoutDir).sessions, (n) => n.endsWith('.json'))) {
    const s = readJson(f, null);
    const seen = s ? Date.parse(s.lastSeenAt || s.startedAt || 0) : 0;
    const dead = !s || s.closed || !pidAlive(s.pid);
    if (dead && now - seen > maxAgeMs) { try { fs.unlinkSync(f); removed++; } catch { /* already gone */ } }
  }
  return removed;
}
