// Lease upkeep, once per worker tick (ADR-007). The pre-edit hook takes leases; everything slower lives here:
//   - let go of leases whose session ended, went idle, or asked to release, and delete their remote refs;
//   - renew the remote lease of every file still being worked on, before it can expire under its holder;
//   - take on the remote any lease the hook could only take locally because the network was down;
//   - write the view of everyone's leases that `status` shows, and collect refs nobody has renewed in an hour.
// Never throws. A network failure stops the remote work for this tick and nothing else.
import path from 'node:path';
import { writeJsonAtomic, exists } from '../core/fsx.mjs';
import { logLine } from '../core/log.mjs';
import { listRecords, patchRecord, dropRecord, holderSessionLive } from '../features/lease-table.mjs';
import { GRACE_MS, clearBreaker, tripBreaker } from '../features/leases.mjs';

const COLLECT_AFTER_MS = 60 * 60_000;
const COLLECT_PER_TICK = 20;

export function leaseViewFile(remoteDir) { return path.join(remoteDir, 'leases.json'); }

function docFor(rec, now, ttlMs) {
  return { handle: rec.handle, device: rec.device, seat: rec.seat || null, path: rec.path, at: rec.at, exp: new Date(now + ttlMs).toISOString() };
}
function mine(doc, rec) { return doc.handle === rec.handle && doc.device === rec.device && (doc.seat || null) === (rec.seat || null); }

/**
 * `store` is a LeaseRefs (or null when leases stay on this machine right now). Returns counts, for the log and tests:
 * { released, renewed, contested, collected, remote: 'ok' | 'skipped' | 'failed' }.
 */
export function maintainLeases({ remoteDir, now = Date.now(), ttlMs = 10 * 60_000, idleMs = 15 * 60_000, store = null }) {
  const out = { released: 0, renewed: 0, contested: 0, collected: 0, remote: store ? 'ok' : 'skipped' };
  try {
    let net = Boolean(store);
    const fail = (why) => { net = false; out.remote = 'failed'; logLine('leases', `upkeep stopped using the remote this tick: ${why}`); };

    for (const rec of listRecords(remoteDir)) {
      const touched = Date.parse(rec.touchedAt);
      const gone = rec.state === 'releasing' || !exists(rec.checkoutDir) || !holderSessionLive(rec) || !(now - touched <= idleMs);
      if (gone) {
        if (rec.remote) {
          if (net) {
            const rm = store.remove(rec.hash, rec.remote.sha);
            if (!rm.ok) { fail(rm.errorClass || 'remove failed'); }
          }
          // The ref could not be deleted. Keep the record as 'releasing' so the next tick tries again, unless
          // the lease has expired past the grace period on its own: then nobody honours it and it can go.
          const exp = rec.remote.exp ? Date.parse(rec.remote.exp) : NaN;
          const expired = Number.isFinite(exp) && now > exp + GRACE_MS;
          if (!net && !expired) {
            if (rec.state !== 'releasing') patchRecord(remoteDir, rec.hash, rec.nonce, { state: 'releasing' });
            continue;
          }
        }
        if (dropRecord(remoteDir, rec.hash, rec.nonce)) out.released += 1;
        continue;
      }
      if (!net) continue;
      const exp = rec.remote && rec.remote.exp ? Date.parse(rec.remote.exp) : NaN;
      if (rec.remote && !rec.contested && Number.isFinite(exp) && exp - now > ttlMs / 2) continue;
      // Renew, or take for the first time, by compare-and-swap on what this seat last wrote.
      const doc = docFor(rec, now, ttlMs);
      let put = store.put(rec.hash, doc, rec.remote ? rec.remote.sha : '');
      if (!put.ok && put.why === 'taken') {
        const cur = store.read(rec.hash, { now });
        if (!cur.ok) { fail(cur.errorClass || 'read failed'); continue; }
        const theirs = cur.doc;
        if (cur.sha !== null && theirs && !mine(theirs, rec) && now <= theirs.expMs + GRACE_MS) {
          // Someone else holds it on the remote: this seat edited while offline, or slept through its expiry.
          // Flag it. The next pre-edit goes to the remote and is refused there; nothing is refused from here.
          patchRecord(remoteDir, rec.hash, rec.nonce, { contested: true, remote: null });
          out.contested += 1;
          continue;
        }
        put = store.put(rec.hash, doc, cur.sha || '');
        if (!put.ok && put.why === 'taken' && cur.sha === null) {
          // Refused twice with nothing there: the server will not take this ref at all. Stop for a while,
          // here and in the hooks, instead of pushing at a closed door every tick.
          tripBreaker(remoteDir, now, 'policy');
          fail('the remote refuses lease refs');
          continue;
        }
      }
      if (put.ok) {
        patchRecord(remoteDir, rec.hash, rec.nonce, { remote: { sha: put.sha, exp: doc.exp }, contested: false });
        out.renewed += 1;
      } else if (put.why !== 'taken') {
        fail(put.errorClass || 'put failed');
      }
    }

    if (net) {
      const listed = store.list({ now });
      if (!listed.ok) { fail(listed.errorClass || 'list failed'); return out; }
      clearBreaker(remoteDir);
      // Does the remote still say what this machine believes? A lease can change under its holder without the
      // holder pushing anything: a person forced a takeover, or the ref was deleted. Waiting for the next
      // renewal to find out would leave the old holder editing for half a TTL, so compare on every tick. The
      // listing was fetched anyway; this costs no round trip.
      const onRemote = new Map(listed.leases.map((l) => [l.hash, l]));
      for (const rec of listRecords(remoteDir)) {
        if (rec.state !== 'held' || !rec.remote) continue;
        const l = onRemote.get(rec.hash);
        if (l && l.sha === rec.remote.sha) continue;
        const taken = Boolean(l && l.doc && !mine(l.doc, rec) && now <= l.doc.expMs + GRACE_MS);
        if (patchRecord(remoteDir, rec.hash, rec.nonce, { remote: null, contested: taken }) && taken) out.contested += 1;
      }
      const view = [];
      let budget = COLLECT_PER_TICK;
      for (const l of listed.leases) {
        const dead = !l.doc || now > l.doc.expMs + COLLECT_AFTER_MS;
        if (dead) {
          // Any client may collect a lease nobody has renewed for an hour. The delete is a compare-and-swap on
          // the sha just read, so a lease renewed in the meantime survives.
          if (budget > 0 && store.remove(l.hash, l.sha).ok) { budget -= 1; out.collected += 1; }
          continue;
        }
        if (now > l.doc.expMs + GRACE_MS) continue;
        view.push({ hash: l.hash, handle: l.doc.handle, device: l.doc.device, seat: l.doc.seat, path: l.doc.path, at: l.doc.at, exp: l.doc.exp });
      }
      try { writeJsonAtomic(leaseViewFile(remoteDir), { fetchedAt: new Date(now).toISOString(), leases: view.slice(0, 500) }); } catch { /* the view is a convenience */ }
    }
  } catch (err) {
    logLine('leases', `upkeep threw: ${err && err.message}`);
    out.remote = 'failed';
  }
  return out;
}
