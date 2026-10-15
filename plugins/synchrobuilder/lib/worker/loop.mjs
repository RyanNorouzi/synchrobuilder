// The background sync worker (ADR-001 section 5). One per (machine, remote): it holds a lock, rebuilds this
// developer's state from the journal, publishes it, pulls everyone else's, and writes snapshot.json.
// Hooks never do any of this; they only read the snapshot the worker leaves behind.
import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJsonAtomic, exists } from '../core/fsx.mjs';
import { logLine } from '../core/log.mjs';
import { readTeam, readConfig } from '../core/config.mjs';
import { isSeat } from '../core/schema.mjs';
import { shortHash } from '../core/paths.mjs';
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

/** Checkouts registered against this remote, written by the session-start hook and pruned here.
 *
 *  One file per seat rather than one shared array. The array was a read-modify-write with no lock, so two
 *  worktrees starting a session at the same moment could each read the same list and write back a copy
 *  missing the other. A directory of small files has no such window. The legacy `checkouts.json` is still
 *  read so an upgrade does not lose registrations written by an older version. */
export function readRegistry(remoteDir) {
  const ok = (c) => c && typeof c.checkoutDir === 'string' && typeof c.workTree === 'string';
  const byDir = new Map();
  const legacy = readJson(path.join(remoteDir, 'checkouts.json'), null);
  for (const c of (legacy && Array.isArray(legacy.checkouts) ? legacy.checkouts : [])) {
    if (ok(c)) byDir.set(c.checkoutDir, c);
  }
  const dir = path.join(remoteDir, 'checkouts');
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.json')); } catch { names = []; }
  for (const n of names) {
    const c = readJson(path.join(dir, n), null);
    if (ok(c)) byDir.set(c.checkoutDir, c);
  }
  return [...byDir.values()].slice(0, 64);
}

export function registerCheckout(remoteDir, entry) {
  // Two separate concerns, which were conflated before. The stored `seat` must satisfy isSeat or be null, so
  // readSeats can never read back a value it would refuse. The file NAME only has to be unique and safe, so it
  // falls back to a hash of the checkout path when there is no seat, rather than refusing to register at all.
  const fromDir = path.basename(String(entry.checkoutDir || ''));
  const seat = isSeat(entry.seat) ? entry.seat : (isSeat(fromDir) ? fromDir : null);
  const file = seat || shortHash(String(entry.checkoutDir || 'seat'));
  const dir = path.join(remoteDir, 'checkouts');
  try {
    fs.mkdirSync(dir, { recursive: true });
    writeJsonAtomic(path.join(dir, `${file}.json`), { ...entry, seat, updatedAt: new Date().toISOString() });
    return true;
  } catch { return false; }
}

async function makeTransport({ remoteUrl, remoteDir, handle, device, seat, mode, lastKnownSha, authorEmail }) {
  if (!remoteUrl) return new LocalTransport({ handle, device });
  try {
    const { GitRefsTransport } = await import('../transport/git-refs.mjs');
    return new GitRefsTransport({ remoteUrl, remoteDir, handle, device, seat, mode, lastKnownSha, authorEmail });
  } catch (err) {
    logLine('worker', `git transport unavailable (${err && err.message}); running local-only`);
    return new LocalTransport({ handle, device });
  }
}

/** One sync cycle for every seat registered against this remote. Never throws.
 *
 *  Every registered working tree is published to its own ref. The previous version reassigned one `tree`
 *  variable inside the loop and published only whichever entry came last, so a second clone or worktree had
 *  its claims, presence and messages silently discarded. */
export async function tick({ remoteDir, now = Date.now(), state = {}, mayPublish = true }) {
  const rp = paths.remote(remoteDir);
  const registry = readRegistry(remoteDir);
  const result = { published: false, pulled: false, writers: 0, mode: 'local', checkouts: registry.length, seats: 0, errorClass: null };
  if (!registry.length) return result;
  const previous = readJson(rp.snapshot, null);
  const status = readJson(rp.status, {}) || {};

  // Build one publishable tree per seat. Identity is resolved per entry: two worktrees usually share a handle
  // and a device, but they never share a seat, and a second clone may resolve a different identity entirely.
  const seats = [];
  let config = null;
  for (const entry of registry) {
    if (!exists(entry.checkoutDir)) continue;
    pruneSessions(entry.checkoutDir, { now });
    const live = liveSessions(entry.checkoutDir);
    config = config || readConfig(entry.workTree);
    const identity = resolveIdentity({ workTree: entry.workTree, checkoutDir: entry.checkoutDir });
    if (!identity) continue;
    // A session that ended without finalizing its handoff draft: publish what it staged.
    const draft = readDraft(entry.checkoutDir);
    if (draft && !draft.finalizedAt && !live.some((s) => s.sessionId === draft.sid)) {
      const fin = finalizeHandoff(entry.checkoutDir, {}, { draftId: draft.id, sid: draft.sid, now, from: identity.handle });
      if (!fin.ok) logLine('worker', `handoff not finalized: ${fin.error}`);
    }
    const seat = entry.seat || null;
    const built = buildOwnTree({
      checkoutDir: entry.checkoutDir, handle: identity.handle, device: identity.device, seat,
      branch: readBranch(entry.gitDir || path.join(entry.workTree, '.git')),
      sessionStartedAt: live.length ? live[0].startedAt : null, pluginVersion: pluginVersion(), now,
    });
    if (!built) continue;
    writeOwnTree(entry.checkoutDir, built.tree);
    seats.push({
      entry, identity, seat, tree: built.tree,
      own: {
        handle: identity.handle, device: identity.device, seat, sha: built.hash, namespace: 'own',
        presence: built.presence,
        claims: JSON.parse(built.tree['claims.json']),
        board: JSON.parse(built.tree['board.json']),
        contracts: JSON.parse(built.tree['contracts.json']),
        messages: [], handoffs: [],
      },
    });
  }
  if (!seats.length) return result;
  result.seats = seats.length;
  state.workTree = seats[0].entry.workTree;

  const mode = status.mode || (config && config.transport && config.transport.namespace === 'branch' ? 'branch' : 'custom');
  const realEmail = Boolean(config && config.transport && config.transport.realEmail);
  const makeFor = (s) => makeTransport({
    remoteUrl: s.entry.remoteUrl || registry[0].remoteUrl, remoteDir,
    handle: s.identity.handle, device: s.identity.device, seat: s.seat, mode,
    lastKnownSha: status.lastKnownSha || {},
    authorEmail: realEmail ? s.identity.email || null : null,
  });

  // Publish each seat whose own tree changed, or any seat at all once the publish interval has elapsed.
  state.lastPublishedHash = (state.lastPublishedHash && typeof state.lastPublishedHash === 'object') ? state.lastPublishedHash : {};
  const due = !state.lastPublishAt || now - state.lastPublishAt >= PUBLISH_EVERY_MS;
  if (!mayPublish) result.skippedPublish = 'another worker holds the lock';
  let lastTransport = null;
  for (const s of seats) {
    const key = s.seat || 'default';
    const transport = await makeFor(s);
    lastTransport = transport;
    if (!mayPublish) continue;
    if (state.lastPublishedHash[key] === s.own.sha && !due) continue;
    const pub = await transport.publish(s.tree);
    if (pub.ok) { result.published = true; state.lastPublishedHash[key] = s.own.sha; }
    else result.errorClass = result.errorClass || (pub.status && pub.status.lastErrorClass);
  }
  if (result.published) state.lastPublishAt = now;

  // One pull serves every seat: the fetch brings down the whole namespace, siblings included.
  const puller = lastTransport || (await makeFor(seats[0]));
  const pull = await puller.pull();
  const tstatus = puller.status();
  result.mode = tstatus.mode;
  result.pulled = !!pull.ok;
  const team = readTeam(state.workTree || registry[0].workTree);
  const own = seats.map((s) => s.own);
  const localDevice = seats[0].identity.device;
  if (pull.ok) {
    const snapshot = foldSnapshot({ writers: pull.writers, previous, team, own, transport: tstatus, now, localDevice });
    try { writeJsonAtomic(rp.snapshot, snapshot); } catch (err) { logLine('worker', `snapshot write failed: ${err && err.message}`); }
    result.writers = snapshot.writers.length;
  } else {
    result.errorClass = result.errorClass || (pull.status && pull.status.lastErrorClass);
    // Never overwrite good data with a failure: keep the old snapshot and only restamp its transport status.
    const kept = staleSnapshot(previous, tstatus, now);
    const merged = previous ? kept : foldSnapshot({ writers: [], team, own, transport: tstatus, now, localDevice });
    try { writeJsonAtomic(rp.snapshot, merged); } catch { /* keep going */ }
    result.writers = (merged.writers || []).length;
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
  // acquireLock returns a result object, so it must be read through .ok: an object is always truthy and a
  // bare negation would let a second worker start beside the first and race it for this writer's ref.
  if (!once) {
    const got = acquireLock(rp.lock);
    if (!got.ok) return { ok: false, reason: 'another worker holds the lock', holder: got.holder || null };
  }
  // A one-off tick does not take the lock, so it must not publish while a live worker owns this writer's ref:
  // both would build a tree from their own read of the journal and the later push would win, possibly with older state.
  const mayPublish = once ? !lockHeldByLive(rp.lock) : true;
  const state = {};
  let failures = 0;
  let idleTicks = 0;
  let last = null;
  try {
    for (;;) {
      const t = now();
      // Baseline for the next sleep, taken before the tick rather than after it. A hook that kicks while the
      // tick is still running would otherwise have its wake-up swallowed, and its work would sit unpublished
      // for a whole interval.
      const tickStartedAt = Date.now();
      last = await tick({ remoteDir, now: t, state, mayPublish });
      failures = last.errorClass ? failures + 1 : 0;
      if (once) return { ok: true, ...last };
      // Losing the lock means another worker took over after this pid looked dead (a suspended laptop, a stopped
      // process). Two publishers for one ref let an older tree win the push, so the loser stops here.
      if (!heartbeatLock(rp.lock)) return { ok: true, reason: 'lost the lock to another worker', ...last };
      const anyLive = readRegistry(remoteDir).some((c) => liveSessions(c.checkoutDir).length > 0);
      idleTicks = anyLive ? 0 : idleTicks + 1;
      if (idleTicks >= 2) return { ok: true, reason: 'no live sessions', ...last };
      const cfg = readConfig(state.workTree || '.');
      const waitFor = waitMs(cfg, last.errorClass, failures);
      await sleepUntilKick({ remoteDir, waitFor, sleep, since: tickStartedAt });
    }
  } catch (err) {
    logLine('worker', `loop failed: ${err && err.stack ? err.stack.split('\n')[0] : err}`);
    return { ok: false, reason: String(err && err.message), ...(last || {}) };
  } finally {
    if (!once) releaseLock(rp.lock);
  }
}

/** Sleep, but wake early when any registered checkout touches its kick file.
 *  `since` is when the tick that preceded this sleep began, so a kick that landed while that tick was still
 *  running still counts and is not silently dropped. It returns immediately in that case. */
export async function sleepUntilKick({ remoteDir, waitFor, sleep, since = null }) {
  const kicks = readRegistry(remoteDir).map((c) => paths.checkout(c.checkoutDir).kick);
  const mtime = (f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };
  const before = kicks.map(mtime);
  // A kick that landed while the preceding tick was running is already newer than that tick's start: act on it
  // now instead of sleeping through work that is waiting to be published.
  if (since !== null && before.some((m) => m > since)) return;
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
