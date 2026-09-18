// Folds the shared task board from every writer's board entries plus this checkout's own journal (which is newer than the
// snapshot's copy of our own state). Newest update per task id wins; a local journal event wins a tie.
// Journal board event: { type: 'board', op: 'add'|'take'|'done', task: { id, title, deps, status, owner } }.
import crypto from 'node:crypto';
import { validBoard, isTaskId, LIMITS } from '../core/schema.mjs';

const STATUS_ORDER = { 'in-progress': 0, open: 1, blocked: 2, done: 3 };

function stamp(iso, fallback) { const t = Date.parse(iso || ''); return Number.isFinite(t) ? t : fallback; }

export function foldBoard(snapshot, journalEvents = [], now = Date.now()) {
  const byId = new Map();
  const consider = (task, updatedMs, local) => {
    const cur = byId.get(task.id);
    if (!cur || updatedMs > cur.updatedMs || (updatedMs === cur.updatedMs && local)) byId.set(task.id, { ...task, updatedMs, local });
  };
  for (const w of snapshot && snapshot.writers ? snapshot.writers : []) {
    for (const t of w.board || []) consider(t, stamp(t.updatedAt, stamp(w.firstSeenAt, 0)), false);
  }
  for (const e of journalEvents) {
    if (e.type !== 'board' || !e.task) continue;
    const [t] = validBoard([{ ...e.task, updatedAt: e.t }], now);
    if (t) consider(t, stamp(e.t, now), true);
  }
  const tasks = [...byId.values()];
  const done = new Set(tasks.filter((t) => t.status === 'done').map((t) => t.id));
  for (const t of tasks) {
    t.missingDeps = t.deps.filter((d) => !byId.has(d));
    t.blockedBy = t.deps.filter((d) => !done.has(d));
    t.ready = t.status === 'open' && !t.owner && t.blockedBy.length === 0;
  }
  return tasks.sort((a, b) => (STATUS_ORDER[a.status] - STATUS_ORDER[b.status]) || (a.updatedMs - b.updatedMs) || a.id.localeCompare(b.id));
}

/** The first open, unowned task whose dependencies are all done; null when nothing is ready. */
export function nextTask(tasks) { return tasks.find((t) => t.ready) || null; }

export function summarizeBoard(tasks) {
  const counts = { open: 0, 'in-progress': 0, blocked: 0, done: 0 };
  for (const t of tasks) counts[t.status === 'open' && t.blockedBy.length ? 'blocked' : t.status]++;
  return counts;
}

/** slug-of-title plus 4 random hex, always a valid task id (at most 40 chars). */
export function makeTaskId(title, hex = crypto.randomBytes(2).toString('hex')) {
  let slug = String(title).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  slug = slug.slice(0, LIMITS.taskId - 5).replace(/-+$/, '') || 'task';
  const id = `${slug}-${hex}`;
  return isTaskId(id) ? id : `task-${hex}`;
}
