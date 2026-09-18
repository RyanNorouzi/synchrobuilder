// This checkout's own claims, folded from its journal (claim and release events), and the resolution of a CLI argument to a
// path or a task id. Journal events: claim { id, path?, task?, note? }, release { id?, path?, task? } (empty release = all).
import fs from 'node:fs';
import path from 'node:path';
import { LIMITS, isTaskId, validRepoPath } from '../core/schema.mjs';
import { samePath, repoRelativePath } from './common.mjs';

export function ownClaims(events, now = Date.now()) {
  const map = new Map();
  for (const e of events) {
    if (e.type === 'claim') {
      const p = e.path !== undefined ? validRepoPath(e.path) : null;
      const task = isTaskId(e.task) ? e.task : null;
      if (!p && !task) continue;
      const key = p ? `p:${p}` : `t:${task}`;
      map.set(key, { id: typeof e.id === 'string' ? e.id : null, path: p, task, note: typeof e.note === 'string' ? e.note : '', at: e.t });
    } else if (e.type === 'release') {
      if (!e.id && !e.path && !e.task) { map.clear(); continue; }
      for (const [k, c] of map) {
        if ((e.id && c.id === e.id) || (e.path && c.path && samePath(c.path, String(e.path))) || (e.task && c.task === e.task)) map.delete(k);
      }
    }
  }
  return [...map.values()].filter((c) => { const t = Date.parse(c.at || ''); return Number.isFinite(t) && now - t < LIMITS.claimTtlMs; });
}

/**
 * A board task id wins when it exists on the board; otherwise a path inside the work tree; otherwise a bare task id.
 * Returns { path } | { task } | null.
 */
export function resolveClaimTarget(loc, cwd, arg, boardIds = new Set()) {
  if (typeof arg !== 'string' || !arg.trim()) return null;
  const a = arg.trim();
  if (isTaskId(a) && boardIds.has(a)) return { task: a };
  const rel = repoRelativePath(loc, cwd, a);
  if (rel && (a.includes('/') || a.includes('\\') || a.includes('.') || fs.existsSync(path.join(loc.workTree, rel)))) return { path: rel };
  if (isTaskId(a)) return { task: a };
  return rel ? { path: rel } : null;
}

export function describeTarget(t) { return t.path ? t.path : `task ${t.task}`; }
