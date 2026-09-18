// Local journal helper for the features and CLI commands (the lead switches callers to lib/state/journal.mjs after merge).
// Event shape, shared with the worker: { t: iso, sid, type, ...fields }. One JSON object per line, LF-terminated.
// Appending also touches <checkoutDir>/kick so the worker publishes on its next tick. Never throws (fail open).
import fs from 'node:fs';
import { appendLine, touch } from '../core/fsx.mjs';
import { paths } from '../state/layout.mjs';
import { logLine } from '../core/log.mjs';

export function appendJournal(checkoutDir, event, { sid = '', kick = true, t } = {}) {
  if (!checkoutDir || !event || typeof event.type !== 'string') return false;
  const p = paths.checkout(checkoutDir);
  const record = { t: t || new Date().toISOString(), sid: String(sid || ''), ...event };
  try {
    appendLine(p.journal, JSON.stringify(record));
    if (kick) touch(p.kick);
    return true;
  } catch (err) {
    logLine('journal', `append failed: ${err && err.message}`);
    return false;
  }
}

/** Parse the last `maxBytes` of the journal (the file can grow; hooks only need recent events). Oldest first. */
export function readJournalTail(checkoutDir, { maxBytes = 256 * 1024 } = {}) {
  if (!checkoutDir) return [];
  const file = paths.checkout(checkoutDir).journal;
  let fd = null;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - maxBytes);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    let text = buf.toString('utf8');
    if (start > 0) { const nl = text.indexOf('\n'); text = nl === -1 ? '' : text.slice(nl + 1); }
    const events = [];
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line);
        if (e && typeof e === 'object' && typeof e.type === 'string') events.push(e);
      } catch { /* a torn line from a concurrent append; skip it */ }
    }
    return events;
  } catch {
    return [];
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch { /* already closed */ } }
  }
}

/** Repo-relative paths this checkout edited recently, newest first, from `edit` events: Map<path, lastEditMs>. */
export function recentEdits(events, now, windowMs = 24 * 3600 * 1000, { sid } = {}) {
  const map = new Map();
  for (const e of events) {
    if (e.type !== 'edit' || typeof e.path !== 'string') continue;
    if (sid && e.sid !== sid) continue;
    const t = Date.parse(e.t);
    if (!Number.isFinite(t) || now - t > windowMs) continue;
    map.set(e.path, Math.max(map.get(e.path) || 0, t));
  }
  return new Map([...map.entries()].sort((a, b) => b[1] - a[1]));
}
