// PreToolUse collision check: before Claude edits a file, say who claimed it or edited it recently. Warn by default, ask only
// when the team opted in, the snapshot is fresh and the permission mode allows a prompt (ADR-001 section 6, PLAN section 1.7).
// Throttled to once per file per config.collision.windowMinutes through <checkoutDir>/warned.json. Advisory: never blocks.
import path from 'node:path';
import { readJson, writeJsonAtomic } from '../core/fsx.mjs';
import { CASE_INSENSITIVE } from '../core/paths.mjs';
import { readConfig } from '../core/config.mjs';
import { LIMITS } from '../core/schema.mjs';
import { sanitizeLine } from '../safety/sanitize.mjs';
import { logLine } from '../core/log.mjs';
import { nowMs, readIdentity, snapshotFromCtx, teammates, claimActive, claimAgeMs, coversPath, samePath, repoRelativePath, fmtAgo, hhmmZ, MS } from './common.mjs';
import { renderBudgeted } from './budget.mjs';

const EDIT_WINDOW_MS = 30 * MS.minute;
const NEVER_ASK = new Set(['dontAsk', 'bypassPermissions', 'plan']);
const MAX_ENTRIES = 5;

export function editedPath(toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return null;
  return typeof toolInput.file_path === 'string' ? toolInput.file_path : typeof toolInput.notebook_path === 'string' ? toolInput.notebook_path : null;
}

/** Teammates' active claims covering `rel` (exact path or an ancestor directory) and their edits of it within 30 min. Newest first. */
export function findMatches(snapshot, identity, rel, now) {
  const out = [];
  for (const w of teammates(snapshot, identity)) {
    if (w.verified !== 'yes') continue; // ADR-005 section 6: only verified writers reach the collision surface
    for (const c of w.claims || []) {
      if (c.path && claimActive(c, w, now) && coversPath(c.path, rel)) out.push({ kind: 'claim', writer: w, path: c.path, ageMs: claimAgeMs(c, w, now), note: c.note || '' });
    }
    for (const e of w.edits || []) {
      const age = now - Date.parse(e.at);
      if (samePath(e.path, rel) && age >= 0 && age < EDIT_WINDOW_MS) out.push({ kind: 'edit', writer: w, path: e.path, ageMs: age, note: '' });
    }
  }
  return out.sort((a, b) => a.ageMs - b.ageMs);
}

/** True when this path was warned about inside the window; otherwise records now and returns false. Fails open (no throttle). */
function throttled(checkoutDir, rel, now, windowMinutes) {
  const file = path.join(checkoutDir, 'warned.json');
  const key = CASE_INSENSITIVE ? rel.toLowerCase() : rel;
  const table = readJson(file, null) || {};
  const last = Date.parse(table[key] || '');
  if (Number.isFinite(last) && now - last < windowMinutes * MS.minute) return true;
  const kept = {};
  for (const [k, v] of Object.entries(table)) { const t = Date.parse(v); if (Number.isFinite(t) && now - t < MS.day) kept[k] = v; }
  kept[key] = new Date(now).toISOString();
  try { writeJsonAtomic(file, kept); } catch (err) { logLine('features', `warned.json write failed: ${err && err.message}`); }
  return false;
}

function verb(m) { return m.kind === 'claim' ? 'claimed' : 'edited'; }

export async function collision(ctx, toolInput) {
  if (!ctx || !ctx.loc || ctx.muted) return null;
  const now = nowMs(ctx);
  const rel = repoRelativePath(ctx.loc, ctx.cwd, editedPath(toolInput));
  if (!rel) return null;
  const identity = readIdentity(ctx.loc.checkoutDir);
  const snapshot = snapshotFromCtx(ctx);
  if (!identity || !snapshot || snapshot.tier === 'gone') return null; // over 24 h only the digest mentions staleness
  const matches = findMatches(snapshot, identity, rel, now);
  if (!matches.length) return null;
  const config = readConfig(ctx.loc.workTree);
  if (throttled(ctx.loc.checkoutDir, rel, now, config.collision.windowMinutes)) return null;

  const stale = snapshot.tier === 'stale';
  const ask = config.collision.mode === 'ask' && snapshot.tier === 'fresh' && !NEVER_ASK.has(ctx.permissionMode);
  const entries = matches.slice(0, MAX_ENTRIES).map((m) => {
    const p = m.writer.presence || {};
    const lines = [`${verb(m)} ${m.path} ${fmtAgo(m.ageMs)}`];
    if (m.note) lines.push(sanitizeLine(m.note, LIMITS.task));
    return { meta: { from: m.writer.handle, kind: m.kind, path: m.path, branch: p.branch || '(withheld)', seen: m.writer.firstSeenAt || '(withheld)', verified: m.writer.verified }, lines };
  });
  const result = renderBudgeted({ kind: 'collision', sections: [{ entries }], limit: LIMITS.collisionChars, measure: 'body', generatedAt: new Date(now).toISOString() });
  if (!result) return null;

  const top = matches[0];
  const branch = top.writer.presence && top.writer.presence.branch ? ` (branch ${top.writer.presence.branch})` : '';
  const more = matches.length > 1 ? ` and ${matches.length - 1} more` : '';
  const asOf = stale ? ` as of ${hhmmZ(snapshot.fetchedAt)}` : '';
  const output = { hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: result.text } };
  if (ask) {
    output.hookSpecificOutput.permissionDecision = 'ask';
    output.hookSpecificOutput.permissionDecisionReason = `Synchrobuilder: ${top.writer.handle} ${verb(top)} ${top.path} ${fmtAgo(top.ageMs)}${branch}. Editing ${rel} may collide with their work.`;
  }
  output.systemMessage = `Synchrobuilder: ${top.writer.handle} ${verb(top)} ${top.path} ${fmtAgo(top.ageMs)}${branch}${more}${asOf}`;
  return output;
}
