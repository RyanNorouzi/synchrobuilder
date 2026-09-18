// Handoff: staged on every Stop from this session's local journal events (edits, task summaries, contract changes) plus a few
// labelled lines of the last assistant message; finalized by the CLI (or the worker) into a journal event the writer publishes.
// Journal event: { type: 'handoff', handoff: { id, from, at, branch, task, done, files, interfaces, decisions, blockers, next, for } }.
import path from 'node:path';
import { readJson, writeJsonAtomic } from '../core/fsx.mjs';
import { isHandle, validRepoPath, validHandoff, ulid } from '../core/schema.mjs';
import { logLine } from '../core/log.mjs';
import { nowMs, readIdentity } from './common.mjs';
import { appendJournal, readJournalTail } from './journal-write.mjs';
import { extractFromMessage, describeEdits, cleanLine } from './handoff-text.mjs';

export function draftFile(checkoutDir) { return path.join(checkoutDir, 'handoff-draft.json'); }
export function readDraft(checkoutDir) { return checkoutDir ? readJson(draftFile(checkoutDir), null) : null; }

function ownBranch(checkoutDir) {
  const p = readJson(path.join(checkoutDir, 'own', 'presence.json'), null);
  return p && typeof p.branch === 'string' ? p.branch : null;
}

/** Builds the draft fields from journal events of one session (all events when sid is empty). Exported for tests. */
export function draftFromEvents(events, sid, message) {
  const mine = sid ? events.filter((e) => e.sid === sid) : events;
  const files = [];
  const summaries = [];
  const interfaces = [];
  const mentions = new Set();
  for (const e of mine) {
    if (e.type === 'edit') { const p = validRepoPath(e.path); if (p && !files.includes(p)) files.push(p); }
    if (e.type === 'task-summary' && typeof e.text === 'string') {
      const t = cleanLine(e.text);
      if (t && !summaries.includes(t)) summaries.push(t);
      for (const m of e.text.matchAll(/@([a-z0-9][a-z0-9-]{0,31})(?![a-z0-9-])/g)) if (isHandle(m[1])) mentions.add(m[1]);
    }
    if (e.type === 'contract-change') {
      const p = validRepoPath(e.path);
      const syms = Array.isArray(e.symbols) ? e.symbols.filter((s) => typeof s === 'string').slice(0, 10) : [];
      if (p) { const line = cleanLine(`${p}: ${syms.length ? syms.join(', ') : 'changed'}`); if (!interfaces.includes(line)) interfaces.push(line); }
    }
  }
  const fromText = extractFromMessage(message);
  for (const h of fromText.for) mentions.add(h);
  return {
    task: summaries.length ? summaries[summaries.length - 1] : '',
    done: [...summaries.slice(-5), ...describeEdits(files)].slice(0, 10),
    files: files.slice(-30), interfaces: interfaces.slice(-10),
    decisions: fromText.decisions, blockers: fromText.blockers, next: fromText.next, for: [...mentions].slice(0, 8),
  };
}

/** Stop hook: writes <checkoutDir>/handoff-draft.json atomically. input.last_assistant_message is read here and nowhere stored. */
export async function stageHandoff(ctx, input) {
  if (!ctx || !ctx.loc) return null;
  const now = nowMs(ctx);
  const checkoutDir = ctx.loc.checkoutDir;
  const events = readJournalTail(checkoutDir);
  const fields = draftFromEvents(events, ctx.sessionId, input && typeof input.last_assistant_message === 'string' ? input.last_assistant_message : '');
  const hasContent = fields.done.length || fields.files.length || fields.interfaces.length || fields.decisions.length || fields.blockers.length || fields.next.length;
  if (!hasContent) return null;
  const previous = readDraft(checkoutDir);
  const identity = readIdentity(checkoutDir);
  const draft = {
    id: previous && previous.sid === ctx.sessionId && typeof previous.id === 'string' ? previous.id : ulid(now),
    sid: ctx.sessionId, from: identity ? identity.handle : null, branch: ownBranch(checkoutDir),
    stagedAt: new Date(now).toISOString(), ...fields,
  };
  try { writeJsonAtomic(draftFile(checkoutDir), draft); } catch (err) { logLine('features', `handoff draft write failed: ${err && err.message}`); return null; }
  return draft;
}

const LIST_KEYS = ['done', 'files', 'interfaces', 'decisions', 'blockers', 'next', 'for'];

/**
 * CLI: apply the user's edits (each list key as an array of strings, or `task`) to the staged draft, validate through
 * validHandoff, append the journal event and mark the draft finalized. Returns { ok, handoff } or { ok: false, error }.
 */
export function finalizeHandoff(checkoutDir, edits = {}, { draftId, sid = '', now = Date.now(), from } = {}) {
  const draft = readDraft(checkoutDir);
  if (!draft) return { ok: false, error: 'no staged handoff; run a session first or pass --done' };
  if (draftId && draft.id !== draftId) return { ok: false, error: `draft ${draftId} not found (current draft is ${draft.id})` };
  const identity = readIdentity(checkoutDir);
  const handle = from || (identity && identity.handle) || draft.from;
  if (!isHandle(handle)) return { ok: false, error: 'identity not resolved for this checkout; run /synchrobuilder:iam <handle>' };
  const merged = { ...draft };
  for (const k of LIST_KEYS) if (Array.isArray(edits[k])) merged[k] = edits[k].map((s) => (k === 'files' || k === 'for' ? String(s).trim() : cleanLine(s))).filter(Boolean);
  if (typeof edits.task === 'string') merged.task = cleanLine(edits.task);
  const handoff = validHandoff({ ...merged, id: draft.id, from: handle, at: new Date(now).toISOString() }, now + 60_000);
  if (!handoff) return { ok: false, error: 'handoff did not validate' };
  const ok = appendJournal(checkoutDir, { type: 'handoff', handoff }, { sid: sid || draft.sid || '' });
  if (!ok) return { ok: false, error: 'could not append to the journal' };
  try { writeJsonAtomic(draftFile(checkoutDir), { ...draft, finalizedAt: handoff.at }); } catch { /* the event is what matters */ }
  return { ok: true, handoff };
}
