// Who am I in this repository (ADR-002). Resolution order: the /synchrobuilder:iam override, then the git email mapped
// through the committed team file, then a provisional handle from the email's local part. Never blocks: an unknown
// developer still gets a working handle, labelled as provisional.
import fs from 'node:fs';
import { readJson, writeJsonAtomic } from '../core/fsx.mjs';
import { isHandle, isDevice } from '../core/schema.mjs';
import { readTeam } from '../core/config.mjs';
import { git } from '../core/proc.mjs';
import { logLine } from '../core/log.mjs';
import { getOrCreateDevice } from './device.mjs';
import { paths } from './layout.mjs';

export const SOURCES = Object.freeze(['override', 'team.json', 'provisional']);

/** Turn an email local part into a handle: lower case, non-matching characters to '-', trimmed to the schema's shape. */
export function handleFromEmail(email) {
  const local = String(email || '').split('@')[0] || '';
  const h = local.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+/, '').replace(/-+$/, '').slice(0, 32);
  return isHandle(h) ? h : null;
}

export function readIdentityFile(checkoutDir) {
  const raw = readJson(paths.checkout(checkoutDir).identity, null);
  if (!raw || !isHandle(raw.handle) || !isDevice(raw.device)) return null;
  return raw;
}

export function writeIdentity(checkoutDir, identity) {
  try { writeJsonAtomic(paths.checkout(checkoutDir).identity, identity); return true; }
  catch (err) { logLine('identity', `write failed: ${err && err.message}`); return false; }
}

/** The override a developer sets with `synchrobuilder iam <handle>`. Lives outside the repository, so it is never committed. */
export function setOverride(checkoutDir, handle, { device } = {}) {
  if (!isHandle(handle)) return { ok: false, error: `"${handle}" is not a valid handle (lower-case letters, digits and hyphens, up to 32 characters)` };
  const identity = { handle, device: device || getOrCreateDevice(), source: 'override', resolvedAt: new Date().toISOString() };
  return writeIdentity(checkoutDir, identity) ? { ok: true, identity } : { ok: false, error: 'could not write identity.json' };
}

export function clearOverride(checkoutDir) {
  const current = readIdentityFile(checkoutDir);
  if (current && current.source === 'override') { try { fs.unlinkSync(paths.checkout(checkoutDir).identity); } catch { /* gone */ } }
  return { ok: true };
}

/** Read `user.email` the way git resolves it (repo config wins over global). Only the worker calls this; hooks read identity.json. */
export function gitEmail(workTree) {
  const r = git(['-C', workTree, 'config', '--get', 'user.email'], { timeoutMs: 5000 });
  const email = r.code === 0 ? String(r.stdout || '').trim().toLowerCase() : '';
  return email && email.includes('@') ? email : null;
}

/**
 * Resolve and persist the identity for this checkout. Safe to call every tick: it only rewrites identity.json when
 * something changed, and an existing override always wins.
 */
export function resolveIdentity({ workTree, checkoutDir, email = undefined }) {
  const device = getOrCreateDevice();
  const existing = readIdentityFile(checkoutDir);
  if (existing && existing.source === 'override') {
    if (existing.device !== device) writeIdentity(checkoutDir, { ...existing, device });
    return { ...existing, device };
  }
  const team = readTeam(workTree);
  const addr = email === undefined ? gitEmail(workTree) : email;
  let handle = null;
  let source = 'provisional';
  if (addr) {
    for (const [h, m] of Object.entries(team.members)) {
      if (m.emails.some((e) => e === addr)) { handle = h; source = 'team.json'; break; }
    }
    if (!handle) handle = handleFromEmail(addr);
  }
  if (!handle) {
    // No git email at all: keep any previous answer rather than inventing a new one every tick.
    if (existing) return existing;
    return null;
  }
  const identity = { handle, device, source, resolvedAt: new Date().toISOString() };
  if (!existing || existing.handle !== handle || existing.device !== device || existing.source !== source) writeIdentity(checkoutDir, identity);
  return identity;
}

/** What the status and doctor commands print about identity, including the nudge when the handle is not in the team file. */
export function describeIdentity(identity, team) {
  if (!identity) return 'identity: not resolved (set git config user.email, or run: synchrobuilder iam <handle>)';
  const known = team && team.members && Object.prototype.hasOwnProperty.call(team.members, identity.handle);
  const note = identity.source === 'override' ? 'from your local override'
    : identity.source === 'team.json' ? 'from .synchrobuilder/team.json'
      : known ? 'derived from your git email' : 'derived from your git email, not in .synchrobuilder/team.json (run: synchrobuilder iam <handle>)';
  return `identity: ${identity.handle} (device ${identity.device}, ${note})`;
}
