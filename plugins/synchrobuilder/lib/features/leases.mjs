// Leases (ADR-007): the one atomic primitive behind "two agents never change one file at the same moment".
//
// A lease is taken in two steps, cheapest first.
//   1. This machine. One file per key in a directory every working tree of the remote shares, mutated under a
//      mutex. Resolves in a file read, and covers agents in sibling worktrees.
//   2. The remote, only when a teammate on another machine exists. A ref created by compare-and-swap push
//      (lib/transport/lease-refs.mjs), so machines that have never spoken race for it with exactly one winner.
//
// A lease is a fact about now, not an intention. It is held only while its holder is demonstrably alive: the
// holder's worker renews it, and nobody can be refused over a lease whose expiry has passed. That is what
// makes it safe to refuse an edit across machines, which a claim (an intention, good for hours) never was.
//
// Nothing here throws, and every failure that is not "someone else holds it" resolves to 'open': the edit goes
// ahead. A broken network must cost coordination, never the ability to work.
import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJsonAtomic } from '../core/fsx.mjs';
import { logLine } from '../core/log.mjs';
import { leaseHash } from '../transport/lease-refs.mjs';
import { withTable, readRecord, newRecord, writeRecord, patchRecord, dropRecord, sameSeat, recordLive } from './lease-table.mjs';

/** A stranger's lease may be taken over only this long after it expired. Absorbs clock skew between machines. */
export const GRACE_MS = 2 * 60_000;
/** My own remote lease counts as valid only until this long before it expires, for the same reason. */
export const MARGIN_MS = 60_000;
const TOUCH_EVERY_MS = 30_000;
const BREAKER_MS = 60_000;
// A host that refuses the lease namespace, or credentials that do not work, will not get better in a minute.
const BREAKER_LONG_MS = 15 * 60_000;
const LONG_REASONS = new Set(['policy', 'auth', 'ssh-hostkey']);
const TEAM_WINDOW_MS = 7 * 24 * 3600 * 1000;

export function fileKey(rel) { return `f:${rel}`; }
export function hashOfPath(rel) { return leaseHash(fileKey(rel)); }

function breakerFile(remoteDir) { return path.join(remoteDir, 'lease-net.json'); }
export function tripBreaker(remoteDir, now, reason = 'network') {
  try { writeJsonAtomic(breakerFile(remoteDir), { failedAt: new Date(now).toISOString(), forMs: LONG_REASONS.has(reason) ? BREAKER_LONG_MS : BREAKER_MS, reason: String(reason).slice(0, 20) }); } catch { /* best effort */ }
}
export function clearBreaker(remoteDir) { try { fs.unlinkSync(breakerFile(remoteDir)); } catch { /* was not set */ } }
function breakerOpen(remoteDir, now) {
  const b = readJson(breakerFile(remoteDir), null);
  const t = b ? Date.parse(b.failedAt) : NaN;
  const forMs = b && Number.isFinite(b.forMs) ? Math.min(b.forMs, BREAKER_LONG_MS) : BREAKER_MS;
  return Number.isFinite(t) && now - t < forMs && now >= t;
}

/**
 * Should a lease also be taken on the remote? Only when there is someone to coordinate with and a working,
 * permitted way to reach them. A developer alone pays nothing: no push, no wait, no refs on their remote.
 */
export function remoteLeasesWanted({ config, status, snapshot, identity, remoteDir, now = Date.now() }) {
  const mode = config && config.leases ? config.leases.remote : 'auto';
  if (mode === 'never' || !identity || !remoteDir) return false;
  // 'custom' is the only transport mode with a hidden namespace. In branch mode every lease would be a visible
  // branch, so leases stay on this machine there. publishHeld is the public-remote hold: a lease names a handle
  // and a path, which is exactly what that hold exists to keep off a world-readable remote.
  if (!status || status.mode !== 'custom' || status.publishHeld || !status.lastOkAt) return false;
  // After a network failure, stop trying for a minute. Otherwise every edit while offline waits out a timeout.
  if (breakerOpen(remoteDir, now)) return false;
  if (mode === 'always') return true;
  const writers = snapshot && Array.isArray(snapshot.writers) ? snapshot.writers : [];
  return writers.some((w) => {
    if (!w || w.device === identity.device) return false;
    const seen = Date.parse((w.presence && w.presence.lastSeen) || w.firstSeenAt || '');
    return Number.isFinite(seen) && now - seen < TEAM_WINDOW_MS;
  });
}

function holderOfRecord(rec) {
  return { handle: rec.handle, device: rec.device, seat: rec.seat, local: true, at: rec.at, checkoutDir: rec.checkoutDir };
}
function holderOfDoc(doc) {
  return { handle: doc.handle, device: doc.device, seat: doc.seat, local: false, at: doc.at, exp: doc.exp };
}
function docIsMine(doc, identity) {
  return doc.handle === identity.handle && doc.device === identity.device && (doc.seat || null) === (identity.seat || null);
}

/** Step 1, under the mutex: mine already, held by a live agent here, or taken now. */
function takeLocal({ remoteDir, hash, rel, identity, sid, checkoutDir, now, idleMs }) {
  return withTable(remoteDir, () => {
    const cur = readRecord(remoteDir, hash);
    if (cur && cur.state === 'held' && sameSeat(cur, identity)) {
      let rec = cur;
      if (now - Date.parse(cur.touchedAt) > TOUCH_EVERY_MS || (sid && cur.sid !== sid)) {
        rec = { ...cur, touchedAt: new Date(now).toISOString(), sid: sid || cur.sid };
        writeRecord(remoteDir, hash, rec);
      }
      return { status: 'mine', rec };
    }
    if (cur && recordLive(cur, now, idleMs)) return { status: 'denied', holder: holderOfRecord(cur) };
    const rec = newRecord({ rel, identity, sid, checkoutDir, now, inherit: cur });
    writeRecord(remoteDir, hash, rec);
    return { status: 'took', rec };
  }, { status: 'open', reason: 'table-busy' });
}

/** Step 2, no mutex: make the remote agree, by compare-and-swap. */
function takeRemote({ store, hash, rec, identity, rel, now, ttlMs, deadline }) {
  const left = () => deadline - Date.now();
  const doc = { handle: identity.handle, device: identity.device, seat: identity.seat || null, path: rel, at: rec.at, exp: new Date(now + ttlMs).toISOString() };
  let expect = rec.remote ? rec.remote.sha : '';
  let refusedWithNothingThere = 0;
  // Bounded: acquire, then at most two rounds of "read who has it, and replace it if that is allowed".
  for (let round = 0; round < 3; round++) {
    if (left() < 700) return { status: 'error', reason: 'out-of-time' };
    const put = store.put(hash, doc, expect, { timeoutMs: Math.min(5000, left()) });
    if (put.ok) return { status: 'ok', remote: { sha: put.sha, exp: doc.exp } };
    if (put.why !== 'taken') return { status: 'error', reason: put.errorClass || 'error' };
    if (left() < 700) return { status: 'error', reason: 'out-of-time' };
    const cur = store.read(hash, { timeoutMs: Math.min(4000, left()), now });
    if (!cur.ok) return { status: 'error', reason: cur.errorClass || 'error' };
    if (cur.sha === null) {
      // Released between our push and our read: try again. Twice in a row is not a race, it is a server that
      // will not accept this ref at all (a ruleset, a host without custom namespaces). Stop asking for a while.
      refusedWithNothingThere += 1;
      if (refusedWithNothingThere >= 2) return { status: 'error', reason: 'policy' };
      expect = '';
      continue;
    }
    const theirs = cur.doc;
    // Replaceable: unreadable (nobody can be said to hold it), mine from before (lost local state), or expired
    // past the grace period. Anything else is a live lease and stands.
    const replaceable = !theirs || docIsMine(theirs, identity) || now > theirs.expMs + GRACE_MS;
    if (!replaceable) return { status: 'denied', holder: holderOfDoc(theirs) };
    expect = cur.sha;
  }
  return { status: 'error', reason: 'contended' };
}

/**
 * Take, or confirm, the lease on one repo-relative path for this seat.
 *
 * Returns { status, holder?, remote } where status is:
 *   'held'      this seat already had it            'acquired'  it was free, or its holder was gone
 *   'denied'    a live agent holds it (holder set)  'open'      could not tell; the caller should let the edit through
 * and remote is 'ok' | 'skipped' | 'failed'.
 */
export function acquireLease({ loc, identity, sid = '', rel, now = Date.now(), ttlMs = 10 * 60_000, idleMs = 15 * 60_000, store = null, deadline = Infinity }) {
  try {
    if (!loc || !loc.remoteDir || !identity || !rel) return { status: 'open', reason: 'no-context', remote: 'skipped' };
    const remoteDir = loc.remoteDir;
    const hash = hashOfPath(rel);
    const local = takeLocal({ remoteDir, hash, rel, identity, sid, checkoutDir: loc.checkoutDir, now, idleMs });
    if (local.status === 'open') return { status: 'open', reason: local.reason, remote: 'skipped' };
    if (local.status === 'denied') return { status: 'denied', holder: local.holder, remote: 'skipped' };
    const rec = local.rec;
    const status = local.status === 'mine' ? 'held' : 'acquired';
    if (!store) return { status, remote: 'skipped' };

    // A remote lease this seat already holds, with time to spare, needs no network at all. One inherited from a
    // dead seat has no expiry recorded, and one the worker flagged as contested is in doubt: both go to the remote.
    const exp = rec.remote && rec.remote.exp ? Date.parse(rec.remote.exp) : NaN;
    if (local.status === 'mine' && !rec.contested && Number.isFinite(exp) && exp - now > MARGIN_MS) return { status, remote: 'ok' };

    const r = takeRemote({ store, hash, rec, identity, rel, now, ttlMs, deadline });
    if (r.status === 'ok') {
      patchRecord(remoteDir, hash, rec.nonce, { remote: r.remote, contested: false });
      clearBreaker(remoteDir);
      return { status, remote: 'ok' };
    }
    if (r.status === 'denied') {
      // Give the local slot back, so an agent in a sibling worktree is not refused over a lease we never got.
      dropRecord(remoteDir, hash, rec.nonce);
      return { status: 'denied', holder: r.holder, remote: 'ok' };
    }
    // Could not reach the remote. The local lease stands, which still protects against siblings, and the worker
    // will try the remote again on its next tick.
    if (r.reason !== 'out-of-time' && r.reason !== 'contended') tripBreaker(remoteDir, now, r.reason);
    logLine('leases', `remote lease for ${hash.slice(0, 8)} not taken: ${r.reason}`);
    return { status, remote: 'failed', reason: r.reason };
  } catch (err) {
    logLine('leases', `acquire threw: ${err && err.message}`);
    return { status: 'open', reason: 'error', remote: 'failed' };
  }
}

/**
 * Take the lease whoever holds it. Only ever called for a person, from `lease take --force`: it exists for the
 * holder that is not coming back, so nobody has to wait out an expiry. A live holder finds out at its next
 * edit, which is refused. Same return shape as acquireLease; never 'denied'.
 */
export function forceLease({ loc, identity, sid = '', rel, now = Date.now(), ttlMs = 10 * 60_000, store = null }) {
  try {
    if (!loc || !loc.remoteDir || !identity || !rel) return { status: 'open', reason: 'no-context', remote: 'skipped' };
    const remoteDir = loc.remoteDir;
    const hash = hashOfPath(rel);
    const rec = withTable(remoteDir, () => {
      const next = newRecord({ rel, identity, sid, checkoutDir: loc.checkoutDir, now, inherit: null });
      writeRecord(remoteDir, hash, next);
      return next;
    }, null);
    if (!rec) return { status: 'open', reason: 'table-busy', remote: 'skipped' };
    if (!store) return { status: 'acquired', remote: 'skipped' };
    const cur = store.read(hash, { now });
    if (!cur.ok) return { status: 'acquired', remote: 'failed', reason: cur.errorClass || 'error' };
    const doc = { handle: identity.handle, device: identity.device, seat: identity.seat || null, path: rel, at: rec.at, exp: new Date(now + ttlMs).toISOString() };
    const put = store.put(hash, doc, cur.sha || '');
    if (!put.ok) return { status: 'acquired', remote: 'failed', reason: put.why === 'taken' ? 'contended' : (put.errorClass || 'error') };
    patchRecord(remoteDir, hash, rec.nonce, { remote: { sha: put.sha, exp: doc.exp }, contested: false });
    return { status: 'acquired', remote: 'ok' };
  } catch (err) {
    logLine('leases', `force threw: ${err && err.message}`);
    return { status: 'open', reason: 'error', remote: 'failed' };
  }
}
