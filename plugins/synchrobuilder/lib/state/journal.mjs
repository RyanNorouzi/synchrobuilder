// The journal is local truth (ADR-001 section 1): hooks and the CLI append one JSON object per line and the worker folds it into
// the own tree on every tick. Appends are the only writes hooks make, so they stay cheap and never contend with the worker.
import fs from 'node:fs';
import { paths, JOURNAL_TYPES } from './layout.mjs';
import { appendLine, readText, readLines } from '../core/fsx.mjs';
import { redact } from '../safety/redact.mjs';
import { validTimestamp } from '../core/schema.mjs';

const MAX_LINE_BYTES = 16 * 1024;
const MAX_DEPTH = 6;
const MAX_KEYS = 64;
export const COMPACT_BYTES = 2 * 1024 * 1024;
export const COMPACT_KEEP_LINES = 5000;

// Every string in an event goes through the redactor: the fields are ours, but a claim note or task summary can still
// contain a pasted token, and the journal is what gets published.
function redactDeep(value, depth = 0) {
  if (depth > MAX_DEPTH) return null;
  if (typeof value === 'string') return redact(value).text;
  if (Array.isArray(value)) return value.slice(0, MAX_KEYS).map((v) => redactDeep(v, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value).slice(0, MAX_KEYS)) out[k] = redactDeep(v, depth + 1);
    return out;
  }
  return value;
}

/** Append one event. Returns the record written, or null when the event is not one of JOURNAL_TYPES or is oversized. */
export function appendEvent(checkoutDir, event) {
  if (!event || typeof event !== 'object' || !JOURNAL_TYPES.includes(event.type)) return null;
  const { t, sid, type, ...rest } = event;
  const record = { t: validTimestamp(t) || new Date().toISOString(), sid: typeof sid === 'string' ? sid.slice(0, 64) : '', type, ...redactDeep(rest) };
  const line = JSON.stringify(record);
  if (Buffer.byteLength(line) > MAX_LINE_BYTES) return null;
  const file = paths.checkout(checkoutDir).journal;
  appendLine(file, line);
  compactIfLarge(file);
  return record;
}

/** Read events, oldest first. A truncated last line (a hook killed mid-write) or any garbage line is skipped, never fatal. */
export function readEvents(checkoutDir, { since = null } = {}) {
  const text = readText(paths.checkout(checkoutDir).journal, '');
  const floor = typeof since === 'string' ? Date.parse(since) : Number.isFinite(since) ? since : -Infinity;
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    if (!ev || typeof ev !== 'object' || !JOURNAL_TYPES.includes(ev.type)) continue;
    const ms = Date.parse(ev.t);
    if (!Number.isFinite(ms) || ms < floor) continue;
    out.push(ev);
  }
  return out;
}

/** Keep only the last `keep` lines. Written to a temp file and renamed, so a reader never sees a half file.
 *  An append that lands between the read and the rename is lost; that is one heartbeat, and the next tick republishes everything anyway. */
export function compactJournal(file, keep = COMPACT_KEEP_LINES) {
  const lines = readLines(file);
  if (lines.length <= keep) return false;
  const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`;
  try {
    fs.writeFileSync(tmp, lines.slice(-keep).join('\n') + '\n');
    fs.renameSync(tmp, file);
    return true;
  } catch {
    try { fs.unlinkSync(tmp); } catch { /* never written */ }
    return false;
  }
}

function compactIfLarge(file) {
  try { if (fs.statSync(file).size > COMPACT_BYTES) compactJournal(file); } catch { /* fail open */ }
}
