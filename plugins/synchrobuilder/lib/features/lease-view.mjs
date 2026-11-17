// Who holds which file right now, for `status` and `lease`: this machine's lease table, plus the worker's last
// view of the remote. File reads only. Rows carry validated identifiers and our own or validated paths, so they
// are safe to print (ADR-005 section 4).
import { readJson } from '../core/fsx.mjs';
import { isHandle, isDevice, isSeat, validRepoPath, RE } from '../core/schema.mjs';
import { listRecords, recordLive, sameSeat } from './lease-table.mjs';
import { leaseViewFile } from '../worker/leases.mjs';
import { GRACE_MS } from './leases.mjs';

const RE_HASH = /^[a-f0-9]{40}$/;

/** Rows: { hash, path, handle, where: 'you' | 'here' | 'remote', at, exp? }. Newest first. */
export function leaseRows({ remoteDir, identity, now = Date.now(), idleMs = 15 * 60_000 }) {
  if (!remoteDir) return [];
  const rows = new Map();
  for (const rec of listRecords(remoteDir)) {
    if (!recordLive(rec, now, idleMs)) continue;
    rows.set(rec.hash, { hash: rec.hash, path: rec.path, handle: rec.handle, where: sameSeat(rec, identity) ? 'you' : 'here', at: rec.at });
  }
  const view = readJson(leaseViewFile(remoteDir), null);
  for (const l of (view && Array.isArray(view.leases) ? view.leases.slice(0, 500) : [])) {
    if (!l || !RE_HASH.test(l.hash || '') || rows.has(l.hash)) continue;
    if (!isHandle(l.handle) || !isDevice(l.device) || (l.seat !== null && l.seat !== undefined && !isSeat(l.seat))) continue;
    // Leases from this device are in the table above when they are live; one that is only in the remote view
    // belongs to a session that has ended and is waiting for the worker to delete its ref.
    if (identity && l.device === identity.device) continue;
    const exp = typeof l.exp === 'string' && RE.isoZ.test(l.exp) ? Date.parse(l.exp) : NaN;
    const at = typeof l.at === 'string' && RE.isoZ.test(l.at) ? l.at : null;
    if (!Number.isFinite(exp) || now > exp + GRACE_MS || !at) continue;
    rows.set(l.hash, { hash: l.hash, path: validRepoPath(l.path) || '(path withheld)', handle: l.handle, where: 'remote', at, exp: l.exp });
  }
  return [...rows.values()].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}
