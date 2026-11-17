// PreToolUse lease guard (ADR-007): take the lease on the file about to be edited, and refuse the edit when a
// live agent already holds it.
//
// This is the one place a Synchrobuilder hook says no by default, and the one place a hook touches the network.
// Both are deliberate and both are bounded. It refuses only on positive knowledge that another live agent holds
// the file; every other outcome, including every failure, lets the edit through. And it reaches the remote only
// when a teammate on another machine exists, once per file, under a deadline well inside the hook's timeout.
import path from 'node:path';
import { readJson, writeJsonAtomic } from '../core/fsx.mjs';
import { readConfig, readTeam } from '../core/config.mjs';
import { logLine } from '../core/log.mjs';
import { isHandle, RE } from '../core/schema.mjs';
import { nowMs, readIdentity, repoRelativePath, loadSnapshot, hhmmZ, MS } from './common.mjs';
import { acquireLease, remoteLeasesWanted, hashOfPath } from './leases.mjs';

const DENIAL_CACHE_MS = 20_000;
const HOOK_DEADLINE_MS = 6500;

function editedPath(toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return null;
  return typeof toolInput.file_path === 'string' ? toolInput.file_path : typeof toolInput.notebook_path === 'string' ? toolInput.notebook_path : null;
}

/** A refusal is remembered briefly, so an agent that retries at once gets the same answer without another round trip. */
function cachedDenial(checkoutDir, hash, now) {
  const table = readJson(path.join(checkoutDir, 'lease-denied.json'), null);
  const hit = table && table[hash];
  const at = hit ? Date.parse(hit.at) : NaN;
  if (!Number.isFinite(at) || now < at || now - at >= DENIAL_CACHE_MS) return null;
  // The file is ours, but what it holds ends up in text shown to Claude, so it is checked like anything else.
  const h = hit.holder;
  if (!h || typeof h !== 'object' || !isHandle(h.handle) || typeof h.local !== 'boolean' || typeof h.at !== 'string' || !RE.isoZ.test(h.at)) return null;
  return { handle: h.handle, local: h.local, at: h.at, checkoutDir: typeof h.checkoutDir === 'string' ? h.checkoutDir : '' };
}
function rememberDenial(checkoutDir, hash, holder, now) {
  try {
    const file = path.join(checkoutDir, 'lease-denied.json');
    const kept = {};
    for (const [k, v] of Object.entries(readJson(file, null) || {})) { const t = Date.parse(v && v.at); if (Number.isFinite(t) && now - t < DENIAL_CACHE_MS) kept[k] = v; }
    kept[hash] = { at: new Date(now).toISOString(), holder };
    writeJsonAtomic(file, kept);
  } catch { /* the cache only saves a round trip */ }
}

function who(holder) {
  if (holder.local) {
    const link = readJson(path.join(String(holder.checkoutDir || ''), 'link.json'), null);
    const tree = link && typeof link.workTree === 'string' ? path.basename(link.workTree).replace(/[^\w.-]/g, '').slice(0, 40) : '';
    return `another agent on this machine${tree ? ` (worktree ${tree})` : ''}`;
  }
  return `${holder.handle}'s agent on another machine`;
}

/** Every value interpolated here is a validated identifier, our own path, or a number: no teammate free text (ADR-005). */
function refusalText(holder, rel, idleMinutes) {
  return `Synchrobuilder: ${who(holder)} is editing ${rel} right now (held since ${hhmmZ(holder.at)}), so this edit was not made. `
    + 'Two agents changing one file at the same moment is how work gets lost. Do other work first: every file not held is free. '
    + `The hold ends when they have not touched the file for ${idleMinutes} minutes, when they run "synchrobuilder release ${rel}", or when their session ends. `
    + 'Then pull their changes before you edit it. "synchrobuilder status" shows who holds what. '
    + `If the holder is gone for good, a person can run "synchrobuilder lease take ${rel} --force".`;
}

/**
 * Returns null (go ahead; the collision check runs next) or a complete PreToolUse output.
 * `opts.store` and `opts.wanted` exist for tests; in a hook both are derived here.
 */
export async function leaseGuard(ctx, toolInput, opts = {}) {
  if (!ctx || !ctx.loc || !ctx.loc.remoteDir || ctx.muted) return null;
  const config = readConfig(ctx.loc.workTree);
  if (config.leases.mode === 'off') return null;
  const now = nowMs(ctx);
  const rel = repoRelativePath(ctx.loc, ctx.cwd, editedPath(toolInput));
  if (!rel) return null;
  const identity = readIdentity(ctx.loc.checkoutDir);
  if (!identity) return null;
  const hash = hashOfPath(rel);

  let holder = cachedDenial(ctx.loc.checkoutDir, hash, now);
  let result = holder ? { status: 'denied', holder } : null;
  if (!result) {
    let store = opts.store || null;
    const wanted = opts.wanted !== undefined ? opts.wanted : remoteLeasesWanted({
      config, identity, remoteDir: ctx.loc.remoteDir, now,
      status: readJson(path.join(ctx.loc.remoteDir, 'status.json'), null),
      snapshot: loadSnapshot(ctx.snapshotFile, now),
    });
    if (wanted && !store) {
      try {
        const { LeaseRefs } = await import('../transport/lease-refs.mjs');
        store = new LeaseRefs({ remoteUrl: ctx.loc.remoteUrl, remoteDir: ctx.loc.remoteDir, handle: identity.handle });
      } catch (err) { logLine('leases', `remote store unavailable: ${err && err.message}`); }
    }
    result = acquireLease({
      loc: ctx.loc, identity, sid: ctx.sessionId || '', rel, now, store: wanted ? store : null,
      ttlMs: config.leases.ttlMinutes * MS.minute, idleMs: config.leases.idleMinutes * MS.minute,
      deadline: Date.now() + HOOK_DEADLINE_MS,
    });
    if (result.status === 'denied') rememberDenial(ctx.loc.checkoutDir, hash, result.holder, now);
  }
  if (result.status !== 'denied') return null;
  holder = result.holder;

  // A handle the team file does not list could be anyone with push access. Such a lease is reported, never enforced.
  const team = readTeam(ctx.loc.workTree);
  const unlisted = !holder.local && team.present && !team.members[holder.handle];
  const enforce = config.leases.mode === 'enforce' && !unlisted;
  const text = refusalText(holder, rel, config.leases.idleMinutes);
  const output = { hookSpecificOutput: { hookEventName: 'PreToolUse' } };
  if (enforce) {
    output.hookSpecificOutput.permissionDecision = 'deny';
    output.hookSpecificOutput.permissionDecisionReason = text;
    output.systemMessage = `Synchrobuilder: held back an edit to ${rel}; ${who(holder)} is editing it`;
  } else {
    output.hookSpecificOutput.additionalContext = text.replace('so this edit was not made', unlisted ? 'but their handle is not in team.json, so the edit was allowed' : 'and leases are set to warn, so the edit was allowed');
    output.systemMessage = `Synchrobuilder: ${who(holder)} is also editing ${rel}`;
  }
  return output;
}
