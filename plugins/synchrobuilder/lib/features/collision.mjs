// PreToolUse collision check: before Claude edits a file, say who claimed it or edited it recently. Warn by default, ask only
// when the team opted in, the snapshot is fresh and the permission mode allows a prompt (ADR-001 section 6, PLAN section 1.7).
// Throttled per file through <checkoutDir>/warned.json: config.collision.windowMinutes normally, and the much
// shorter siblingWindowMinutes when the holder is another agent on this machine.
// Advisory by default. The one exception is mode 'block', which denies an edit to a file a LIVE SIBLING on
// this machine is holding. A remote writer can never trigger it and neither can a finished session, and every
// internal error path still fails open (ADR-003 amendment).
import fs from 'node:fs';
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
// A deny is the one thing ADR-003 says a hook must not do, so it is opt-in and deliberately narrow: only a
// live sibling on this machine, only when the team asked for it. A writer that arrived over the network can
// never trigger it, because a remote teammate cannot be confirmed to still be at their desk.
const BLOCKABLE = (m) => Boolean(m && m.writer && m.writer.local && m.writer.live && m.kind === 'claim');
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
function throttled(checkoutDir, rel, now, windowMinutes, suffix = '') {
  const file = path.join(checkoutDir, 'warned.json');
  // The throttle lives in this seat's own directory, so one agent can no longer consume the warning on behalf
  // of every other worktree. The suffix separates "a sibling holds this" from "someone remote holds this",
  // which carry different urgency and different windows.
  const key = (CASE_INSENSITIVE ? rel.toLowerCase() : rel) + suffix;
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

/** withSiblings, but only when this machine has more than one seat on this remote. */
async function maybeWithSiblings(snapshot, loc, identity, now) {
  try {
    const names = fs.readdirSync(path.join(loc.remoteDir || '', 'checkouts'));
    if (names.filter((n) => n.endsWith('.json')).length < 2) return snapshot;
  } catch { return snapshot; }   // no registry directory means no siblings
  try {
    const { withSiblings } = await import('./siblings.mjs');
    return withSiblings(snapshot, loc, identity, now);
  } catch (err) {
    logLine('features', `sibling view unavailable: ${err && err.message}`);
    return snapshot;
  }
}

export async function collision(ctx, toolInput) {
  if (!ctx || !ctx.loc || ctx.muted) return null;
  const now = nowMs(ctx);
  const rel = repoRelativePath(ctx.loc, ctx.cwd, editedPath(toolInput));
  if (!rel) return null;
  const identity = readIdentity(ctx.loc.checkoutDir);
  const remote = snapshotFromCtx(ctx);
  if (!identity) return null;
  // Siblings are read off this disk, so their claims are current even when the last fetch is old or failed.
  // That is what makes two agents in two worktrees react to each other in milliseconds instead of a sync
  // interval. It cannot resurrect a dead remote: anything from another machine still comes via the snapshot.
  //
  // Loaded only when a second seat is actually registered. This hook has a 120 ms watchdog and most checkouts
  // have exactly one seat, so a developer working alone must not pay to import and run a path that can have
  // nothing to say. Counting the registry is one readdir.
  const snapshot = (await maybeWithSiblings(remote, ctx.loc, identity, now)) || remote;
  if (!snapshot || (remote && remote.tier === 'gone' && !snapshot.writers.some((w) => w.local))) return null;
  const matches = findMatches(snapshot, identity, rel, now);
  if (!matches.length) return null;
  const config = readConfig(ctx.loc.workTree);

  const sibling = matches.find(BLOCKABLE) || null;
  const windowMinutes = sibling
    ? Math.min(config.collision.siblingWindowMinutes ?? 2, config.collision.windowMinutes)
    : config.collision.windowMinutes;
  if (throttled(ctx.loc.checkoutDir, rel, now, windowMinutes, sibling ? '#sibling' : '')) return null;

  const stale = snapshot.tier === 'stale';
  const block = config.collision.mode === 'block' && Boolean(sibling);
  const ask = !block && config.collision.mode === 'ask' && snapshot.tier === 'fresh' && !NEVER_ASK.has(ctx.permissionMode);
  const entries = matches.slice(0, MAX_ENTRIES).map((m) => {
    const p = m.writer.presence || {};
    const lines = [`${verb(m)} ${m.path} ${fmtAgo(m.ageMs)}`];
    if (m.note) lines.push(sanitizeLine(m.note, LIMITS.task));
    return { meta: { from: m.writer.handle, kind: m.kind, path: m.path, branch: p.branch || 'withheld', seen: m.writer.firstSeenAt || 'withheld', verified: m.writer.verified }, lines };
  });
  const result = renderBudgeted({ kind: 'collision', sections: [{ entries }], limit: LIMITS.collisionChars, measure: 'body', generatedAt: new Date(now).toISOString() });
  if (!result) return null;

  const top = matches[0];
  const branch = top.writer.presence && top.writer.presence.branch ? ` (branch ${top.writer.presence.branch})` : '';
  const more = matches.length > 1 ? ` and ${matches.length - 1} more` : '';
  const asOf = stale ? ` as of ${hhmmZ(snapshot.fetchedAt)}` : '';
  const output = { hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: result.text } };
  if (block) {
    // The only non-advisory path, and it refuses exactly one thing: editing a file that another agent on this
    // same machine is holding right now. Opt-in through collision.mode, and it names the way out so the agent
    // can act rather than stall.
    const w = sibling.writer;
    const where = w.presence && w.presence.branch ? ` on branch ${w.presence.branch}` : (w.workTree ? ` in ${w.workTree}` : '');
    output.hookSpecificOutput.permissionDecision = 'deny';
    output.hookSpecificOutput.permissionDecisionReason =
      `Synchrobuilder: another agent on this machine is holding ${sibling.path}${where}, claimed ${fmtAgo(sibling.ageMs)}. `
      + 'Pick different work for now. The hold lifts when that agent runs "synchrobuilder release '
      + `${sibling.path}" or its session ends. "synchrobuilder status" shows what every agent here is on.`;
  } else if (ask) {
    output.hookSpecificOutput.permissionDecision = 'ask';
    output.hookSpecificOutput.permissionDecisionReason = `Synchrobuilder: ${top.writer.handle} ${verb(top)} ${top.path} ${fmtAgo(top.ageMs)}${branch}. Editing ${rel} may collide with their work.`;
  }
  const who = top.writer.local ? 'another agent here' : top.writer.handle;
  output.systemMessage = `Synchrobuilder: ${who} ${verb(top)} ${top.path} ${fmtAgo(top.ageMs)}${branch}${more}${asOf}`;
  return output;
}
