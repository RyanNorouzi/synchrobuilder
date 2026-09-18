// SessionStart digest: what Claude should know about the team before the first prompt, wrapped as untrusted teammate data.
// Sections in priority order (ADR-005 step 15): claims touching my recent paths, unseen messages for me, handoffs for me or for
// everyone, presence of active teammates, open board tasks. Fits LIMITS.digestChars; lowest priority is dropped first.
import { LIMITS } from '../core/schema.mjs';
import { sanitizeText, sanitizeLine } from '../safety/sanitize.mjs';
import { nowMs, readIdentity, snapshotFromCtx, teammates, claimActive, claimAgeMs, pathsOverlap, fmtAgo, fmtShortAge, MS } from './common.mjs';
import { readJournalTail, recentEdits } from './journal-write.mjs';
import { readSeen, writeSeen, messageKey, handoffKey } from './seen.mjs';
import { activeWriters } from './presence.mjs';
import { foldBoard } from './board-fold.mjs';
import { renderBudgeted } from './budget.mjs';

const CAPS = { claims: 30, messages: 20, handoffs: 10, presence: 30, board: 20 };
const withheld = (v) => (v === null || v === undefined || v === '' ? '(withheld)' : v);

function base(writer, kind, extra = {}) {
  const p = writer.presence || {};
  return { from: writer.handle, kind, ...extra, branch: withheld(p.branch), seen: withheld(writer.firstSeenAt), verified: writer.verified };
}

function claimEntries(others, recent, now) {
  const paths = [...recent.keys()];
  const out = [];
  for (const w of others) {
    for (const c of w.claims || []) {
      if (!c.path || !claimActive(c, w, now) || !paths.some((p) => pathsOverlap(c.path, p))) continue;
      const lines = [`claimed ${fmtAgo(claimAgeMs(c, w, now))}${c.timeUnverified ? ' (time unverified)' : ''}`];
      if (c.note) lines.push(sanitizeLine(c.note, LIMITS.task));
      out.push({ meta: base(w, 'claim', { path: c.path }), lines, ageMs: claimAgeMs(c, w, now) });
    }
  }
  return out.sort((a, b) => a.ageMs - b.ageMs).slice(0, CAPS.claims);
}

function messageEntries(others, me, seen, now) {
  const out = [];
  for (const w of others) {
    if (w.verified !== 'yes') continue; // ADR-005 section 6: unverified writers never reach the inbox
    for (const m of w.messages || []) {
      if (m.to !== me || m.from !== w.handle) continue;
      const key = messageKey(m);
      if (seen.messages[key]) continue;
      const at = Date.parse(m.at || w.firstSeenAt || '');
      if (Number.isFinite(at) && now - at > LIMITS.messageTtlMs) continue;
      const text = sanitizeText(m.text);
      if (!text) continue;
      out.push({ key, section: 'messages', meta: base(w, 'message', { to: 'me', at: withheld(m.at) }), lines: text.split('\n'), at: Number.isFinite(at) ? at : 0 });
    }
  }
  return out.sort((a, b) => a.at - b.at).slice(0, CAPS.messages);
}

function handoffEntries(others, me, seen, now) {
  const out = [];
  for (const w of others) {
    for (const h of w.handoffs || []) {
      const forMe = h.for.length === 0 || h.for.includes(me);
      const key = handoffKey(h);
      const at = Date.parse(h.at || w.firstSeenAt || '');
      if (!forMe || seen.handoffs[key] || (Number.isFinite(at) && now - at > 7 * MS.day)) continue;
      const lines = [];
      if (h.task) lines.push(`task: ${sanitizeLine(h.task, LIMITS.task)}`);
      const list = (label, items, max) => { if (items.length) lines.push(`${label}: ${items.slice(0, max).map((s) => sanitizeLine(s, LIMITS.task)).join('; ')}`); };
      list('done', h.done, 5); list('interfaces', h.interfaces, 5); list('decisions', h.decisions, 5); list('blockers', h.blockers, 5); list('next', h.next, 5);
      if (h.files.length) lines.push(`files: ${h.files.slice(0, 10).join(', ')}${h.files.length > 10 ? ` (+${h.files.length - 10})` : ''}`);
      const meta = base(w, 'handoff', { branch: withheld(h.branch), at: withheld(h.at), for: h.for.length ? h.for.join(',') : 'everyone' });
      out.push({ key, section: 'handoffs', meta, lines, at: Number.isFinite(at) ? at : 0 });
    }
  }
  return out.sort((a, b) => b.at - a.at).slice(0, CAPS.handoffs);
}

function presenceEntries(rows) {
  return rows.slice(0, CAPS.presence).map((r) => ({
    meta: base(r.writer, 'presence', { age: fmtShortAge(r.ageMs), tier: r.tier, area: withheld(r.area) }),
    lines: r.task ? [`task: ${sanitizeLine(r.task, LIMITS.task)}`] : [],
  }));
}

function boardEntries(tasks) {
  return tasks.filter((t) => t.status !== 'done').slice(0, CAPS.board).map((t) => ({
    meta: { kind: 'board', id: t.id, status: t.status, owner: t.owner || 'nobody', blocked: t.blockedBy.length ? t.blockedBy.join(',') : 'no' },
    lines: [sanitizeLine(t.title, LIMITS.title)],
  }));
}

/** additionalContext string for SessionStart, or null when muted, without identity or snapshot, or nothing relevant. */
export async function digest(ctx) {
  if (!ctx || !ctx.loc || ctx.muted) return null;
  const now = nowMs(ctx);
  const identity = readIdentity(ctx.loc.checkoutDir);
  const snapshot = snapshotFromCtx(ctx);
  if (!identity || !snapshot) return null;
  const others = teammates(snapshot, identity);
  const seen = readSeen(ctx.loc.checkoutDir);
  const events = readJournalTail(ctx.loc.checkoutDir);
  const recent = recentEdits(events, now);
  const live = snapshot.tier !== 'gone'; // over 24 h only the staleness note survives from time-sensitive sections
  const sections = [
    { entries: live ? claimEntries(others, recent, now) : [] },
    { entries: messageEntries(others, identity.handle, seen, now) },
    { entries: handoffEntries(others, identity.handle, seen, now) },
    { entries: live ? presenceEntries(activeWriters(snapshot, now, identity)) : [] },
    { entries: boardEntries(foldBoard(snapshot, events, now)) },
  ];
  if (!live) sections.unshift({ entries: [{ meta: { kind: 'sync', status: 'stale', fetched: withheld(snapshot.fetchedAt), age: fmtShortAge(snapshot.ageMs) }, lines: [] }] });
  if (!sections.some((s) => s.entries.length)) return null;
  const result = renderBudgeted({ kind: 'digest', sections, limit: LIMITS.digestChars, generatedAt: new Date(now).toISOString() });
  if (!result) return null;
  const at = new Date(now).toISOString();
  for (const e of result.entries) { if (e.section === 'messages') seen.messages[e.key] = at; if (e.section === 'handoffs') seen.handoffs[e.key] = at; }
  seen.lastDigestAt = at;
  writeSeen(ctx.loc.checkoutDir, seen, now);
  return result.text;
}
