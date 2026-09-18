// The background sync worker (ADR-001 section 5). One per (machine, remote): it holds a lock, rebuilds this
// developer's state from the journal, publishes it, pulls everyone else's, and writes snapshot.json.
// Hooks never do any of this; they only read the snapshot the worker leaves behind.
import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJsonAtomic, exists } from '../core/fsx.mjs';
import { logLine } from '../core/log.mjs';
import { readTeam, readConfig } from '../core/config.mjs';
import { paths } from '../state/layout.mjs';
import { acquireLock, heartbeatLock, releaseLock, lockHeldByLive } from '../state/lock.mjs';
import { liveSessions, readBranch, pruneSessions } from '../state/sessions.mjs';
import { resolveIdentity } from '../state/identity.mjs';
import { buildOwnTree, writeOwnTree } from '../state/own.mjs';
import { readDraft, finalizeHandoff } from '../features/handoff.mjs';
import { pluginVersion } from '../core/version.mjs';
import { foldSnapshot, staleSnapshot } from './fold.mjs';
import { Transport } from '../transport/interface.mjs';

const PUBLISH_EVERY_MS = 60 * 1000;
const BACKOFF = { minMs: 30_000, maxMs: 10 * 60_000, authMs: 15 * 60_000 };

/** A transport that keeps everything local: used when there is no remote, and as the fallback in tests. */
export class LocalTransport extends Transport {
  constructor({ handle, device } = {}) { super(); this.handle = handle; this.device = device; this.tree = null; }
  async probe() { return { mode: 'local', detail: 'no remote configured' }; }
  async publish(tree) { this.tree = tree; return { ok: true, sha: 'local', mode: 'local', status: this.status() }; }
  async pull() { return { ok: true, writers: [], status: this.status() }; }
  status() { return { mode: 'local', lastError: null, lastErrorClass: null, lastOkAt: new Date().toISOString(), nextAttemptAt: null }; }
}

/** Checkouts registered against this remote, written by the session-start hook and pruned here. */
export function readRegistry(remoteDir) {
  const raw = readJson(path.join(remoteDir, 'checkouts.json'), null);
  const list = raw && Array.isArray(raw.checkouts) ? raw.checkouts : [];
  return list.filter((c) => c && typeof c.checkoutDir === 'string' && typeof c.workTree === 'string');
}

export function registerCheckout(remoteDir, entry) {
  const file = path.join(remoteDir, 'checkouts.json');
  const list = readRegistry(remoteDir).filter((c) => c.checkoutDir !== entry.checkoutDir);
  list.push({ ...entry, updatedAt: new Date().toISOString() });
  try { writeJsonAtomic(file, { checkouts: list.slice(-32) }); return true; } catch { return false; }
}

async function makeTransport({ remoteUrl, remoteDir, handle, device, mode, lastKnownSha, authorEmail }) {
  if (!remoteUrl) return new LocalTransport({ handle, device });
  try {
    const { GitRefsTransport } = await import('../transport/git-refs.mjs');
    return new GitRefsTransport({ remoteUrl, remoteDir, handle, device, mode, lastKnownSha, authorEmail });
  } catch (err) {
    logLine('worker', `git transport unavailable (${err && err.message}); running local-only`);
    return new LocalTransport({ handle, device });
  }
}

/** One sync cycle for every checkout registered against this remote. Never throws. */
export async function tick({ remoteDir, now = Date.now(), state = {} }) {
  const rp = paths.remote(remoteDir);
  const registry = readRegistry(remoteDir);
  const result = { published: false, pulled: false, writers: 0, mode: 'local', checkouts: registry.length, errorClass: null };
  if (!registry.length) return result;
  const previous = readJson(rp.snapshot, null);
  const status = readJson(rp.status, {}) || {};

  // The newest registered checkout drives identity and publishing; the others contribute their journals through
  // their own worker (one remote can be shared by several clones, each with its own checkout directory).
  let ownEntry = null;
  let tree = null;
  let identity = null;
  let config = null;
  for (const entry of registry) {
    if (!exists(entry.checkoutDir)) continue;
    pruneSessions(entry.checkoutDir, { now });
    const live = liveSessions(entry.checkoutDir);
    config = config || readConfig(entry.workTree);
    identity = identity || resolveIdentity({ workTree: entry.workTree, checkoutDir: entry.checkoutDir });
    if (!identity) continue;
    // A session that ended without finalizing its handoff draft: publish what it staged.
    const draft = readDraft(entry.checkoutDir);
    if (draft && !draft.finalizedAt && !live.some((s) => s.sessionId === draft.sid)) {
      const fin = finalizeHandoff(entry.checkoutDir, {}, { draftId: draft.id, sid: draft.sid, now, from: identity.handle });
      if (!fin.ok) logLine('worker', `handoff not finalized: ${fin.error}`);
    }
    const built = buildOwnTree({
      checkoutDir: entry.checkoutDir, handle: identity.handle, device: identity.device,
      branch: readBranch(entry.gitDir || path.join(entry.workTree, '.git')),
      sessionStartedAt: live.length ? live[0].startedAt : null, pluginVersion: pluginVersion(), now,
    });
    if (!built) continue;
    writeOwnTree(entry.checkoutDir, built.tree);
    tree = built.tree;
    ownEntry = {
      handle: identity.handle, device: identity.device, sha: built.hash, namespace: 'own',
      presence: built.presence,
      claims: JSON.parse(built.tree['claims.json']),
      board: JSON.parse(built.tree['board.json']),
      contracts: JSON.parse(built.tree['contracts.json']),
      messages: [], handoffs: [],
    };
    state.ownHash = state.ownHash || {};
    state.treeHash = built.hash;
    state.workTree = entry.workTree;
  }
  if (!identity || !tree) return result;

  const transport = await makeTransport({
    remoteUrl: registry[0].remoteUrl, remoteDir, handle: identity.handle, device: identity.device,
    mode: status.mode || (config && config.transport && config.transport.namespace === 'branch' ? 'branch' : 'custom'),
    lastKnownSha: status.lastKnownSha || {},
    authorEmail: config && config.transport && config.transport.realEmail ? identity.email : null,
  });

  const changed = state.lastPublishedHash !== state.treeHash;
  const due = !state.lastPublishAt || now - state.lastPublishAt >= PUBLISH_EVERY_MS;
  if (changed || due) {
    const pub = await transport.publish(tree);
    result.published = !!pub.ok;
    if (pub.ok) { state.lastPublishedHash = state.treeHash; state.lastPublishAt = now; }
    else result.errorClass = pub.status && pub.status.lastErrorClass;
  }

  const pull = await transport.pull();
  const tstatus = transport.status();
  result.mode = tstatus.mode;
  result.pulled = !!pull.ok;
  const team = readTeam(state.workTree || registry[0].workTree);
  if (pull.ok) {
    const snapshot = foldSnapshot({ writers: pull.writers, previous, team, own: ownEntry, transport: tstatus, now });
    try { writeJsonAtomic(rp.snapshot, snapshot); } catch (err) { logLine('worker', `snapshot write failed: ${err && err.message}`); }
    result.writers = snapshot.writers.length;
  } else {
    result.errorClass = result.errorClass || (pull.status && pull.status.lastErrorClass);
    // Never overwrite good data with a failure: keep the old snapshot and only restamp its transport status.
    const kept = staleSnapshot(previous, tstatus, now);
    if (previous || ownEntry) {
      const merged = previous ? kept : foldSnapshot({ writers: [], team, own: ownEntry, transport: tstatus, now });
      try { writeJsonAtomic(rp.snapshot, merged); } catch { /* keep going */ }
      result.writers = (merged.writers || []).length;
    }
  }
  try {
    writeJsonAtomic(rp.status, {
      mode: tstatus.mode, lastError: tstatus.lastError, lastErrorClass: tstatus.lastErrorClass,
      lastOkAt: tstatus.lastOkAt, nextAttemptAt: tstatus.nextAttemptAt, lastKnownSha: tstatus.lastKnownSha || {},
      workerPid: process.pid, updatedAt: new Date(now).toISOString(),
    });
  } catch { /* status is a convenience */ }
  return result;
}

function waitMs(config, errorClass, failures) {
  if (!errorClass) {
    const base = Math.max(10, Number(config && config.transport && config.transport.intervalSeconds) || 45) * 1000;
    return base + Math.floor(Math.random() * 15_000);
  }
  if (errorClass === 'auth') return BACKOFF.authMs;
  return Math.min(BACKOFF.minMs * 2 ** Math.max(0, failures - 1), BACKOFF.maxMs);
}

/** Run until every registered session is gone. `once` runs a single tick, which is what the tests use. */
export async function runWorker({ remoteDir, once = false, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const rp = paths.remote(remoteDir);
  fs.mkdirSync(remoteDir, { recursive: true });
  if (!once && !acquireLock(rp.lock)) return { ok: false, reason: 'another worker holds the lock' };
  const state = {};
  let failures = 0;
  let idleTicks = 0;
  let last = null;
  try {
    for (;;) {
      const t = now();
      last = await tick({ remoteDir, now: t, state });
      failures = last.errorClass ? failures + 1 : 0;
      if (once) return { ok: true, ...last };
      heartbeatLock(rp.lock);
      const anyLive = readRegistry(remoteDir).some((c) => liveSessions(c.checkoutDir).length > 0);
      idleTicks = anyLive ? 0 : idleTicks + 1;
      if (idleTicks >= 2) return { ok: true, reason: 'no live sessions', ...last };
      const cfg = readConfig(state.workTree || '.');
      const waitFor = waitMs(cfg, last.errorClass, failures);
      await sleepUntilKick({ remoteDir, waitFor, sleep });
    }
  } catch (err) {
    logLine('worker', `loop failed: ${err && err.stack ? err.stack.split('\n')[0] : err}`);
    return { ok: false, reason: String(err && err.message), ...(last || {}) };
  } finally {
    if (!once) releaseLock(rp.lock);
  }
}

/** Sleep, but wake early when any registered checkout touches its kick file. */
async function sleepUntilKick({ remoteDir, waitFor, sleep }) {
  const kicks = readRegistry(remoteDir).map((c) => paths.checkout(c.checkoutDir).kick);
  const before = kicks.map((f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } });
  const step = 1000;
  for (let waited = 0; waited < waitFor; waited += step) {
    await sleep(Math.min(step, waitFor - waited));
    for (let i = 0; i < kicks.length; i++) {
      let mtime = 0;
      try { mtime = fs.statSync(kicks[i]).mtimeMs; } catch { mtime = 0; }
      if (mtime > before[i]) return;
    }
  }
}

export { lockHeldByLive };
