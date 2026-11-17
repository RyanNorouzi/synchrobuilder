// Shared pieces for the lease tests: a second seat on the rig's machine, and an in-memory stand-in for the remote.
import fs from 'node:fs';
import path from 'node:path';
import { NOW } from './features-rig.mjs';
import { validLease } from '../../plugins/synchrobuilder/lib/transport/lease-refs.mjs';

export const MIN = 60_000;
export const SEAT_A = 'a'.repeat(16);
export const SEAT_B = 'b'.repeat(16);

/** Another working tree of the rig's remote on the same machine, with its own seat and a session that is live or not. */
export function seat(rig, seatId, { live = true, sid = `sid-${seatId.slice(0, 2)}` } = {}) {
  const checkoutDir = path.join(rig.home, 'checkouts', seatId);
  const sessionFile = path.join(checkoutDir, 'sessions', `${sid}.json`);
  fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
  const stamp = new Date(NOW).toISOString();
  // 999999999 is above every platform's pid ceiling, so it is a process that cannot exist.
  fs.writeFileSync(sessionFile, JSON.stringify({ sessionId: sid, pid: live ? process.pid : 999999999, closed: false, startedAt: stamp, lastSeenAt: stamp }));
  return {
    loc: { ...rig.loc, checkoutDir }, sid, checkoutDir,
    identity: { handle: 'alice', device: 'aaaaaaaa', seat: seatId },
    close() { fs.writeFileSync(sessionFile, JSON.stringify({ sessionId: sid, pid: process.pid, closed: true })); },
  };
}

/** The same compare-and-swap contract as LeaseRefs, without git: a ref changes only if it is what the caller expected. */
export function fakeStore() {
  const refs = new Map();
  let n = 0;
  const store = {
    refs, calls: { put: 0, read: 0, remove: 0 }, fail: null, refusesAll: false,
    put(hash, doc, expect) {
      store.calls.put++;
      if (store.fail) return { ok: false, why: 'error', errorClass: store.fail };
      // A host that will not accept the namespace turns every push down, and there is never anything to read back.
      if (store.refusesAll) return { ok: false, why: 'taken', errorClass: 'policy' };
      const cur = refs.get(hash);
      if ((cur ? cur.sha : '') !== (expect || '')) return { ok: false, why: 'taken' };
      const sha = String(++n).padStart(40, '0');
      refs.set(hash, { sha, doc: validLease({ v: 1, ...doc }, Date.parse(doc.at)) });
      return { ok: true, sha };
    },
    read(hash) {
      store.calls.read++;
      if (store.fail) return { ok: false, errorClass: store.fail };
      const cur = refs.get(hash);
      return cur ? { ok: true, sha: cur.sha, doc: cur.doc } : { ok: true, sha: null, doc: null };
    },
    remove(hash, expect) {
      store.calls.remove++;
      if (store.fail) return { ok: false, why: 'error', errorClass: store.fail };
      const cur = refs.get(hash);
      if (cur && cur.sha === expect) refs.delete(hash);
      return { ok: true };
    },
    list() {
      if (store.fail) return { ok: false, leases: [] };
      return { ok: true, leases: [...refs.entries()].map(([hash, v]) => ({ hash, sha: v.sha, doc: v.doc })) };
    },
  };
  return store;
}
