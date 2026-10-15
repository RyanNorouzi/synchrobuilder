// Turn the writers a pull returned into snapshot.json, the single local file every hook reads (ADR-001 section 2).
// The reader's clock decides freshness: firstSeenAt is when THIS machine first saw a given (handle, device, sha),
// so a teammate with a wrong clock can neither look permanently online nor expire early.
import { SNAPSHOT_SCHEMA_VERSION } from '../state/layout.mjs';
import { parseWriters } from '../transport/reader.mjs';
import { writerKey } from '../transport/git-refs.mjs';

/** Carry firstSeenAt forward for writers whose commit we have already seen. */
export function carryFirstSeen(entries, previous) {
  const seen = new Map();
  for (const w of (previous && Array.isArray(previous.writers) ? previous.writers : [])) {
    if (w && w.handle && w.device && w.sha && w.firstSeenAt) seen.set(`${writerKey(w)}/${w.sha}`, w.firstSeenAt);
  }
  return entries.map((e) => {
    const known = seen.get(`${writerKey(e)}/${e.sha}`);
    return known ? { ...e, firstSeenAt: known } : e;
  });
}

/**
 * Build the snapshot. `ownEntry` is this developer's own state, folded in so the status command and the
 * status line can show it without a round trip through the remote.
 */
export function foldSnapshot({ writers, previous = null, team = null, own = null, transport = null, now = Date.now(), localDevice = null }) {
  const parsed = carryFirstSeen(parseWriters(writers, { team, receiptMs: now }), previous);
  const list = [...parsed];
  // `own` is every seat this machine publishes: one per working tree. A single entry is still accepted.
  const ours = (Array.isArray(own) ? own : [own]).filter((o) => o && o.handle && o.device);
  for (const entry of ours) {
    const i = list.findIndex((w) => writerKey(w) === writerKey(entry));
    const folded = { ...entry, verified: 'yes', firstSeenAt: new Date(now).toISOString() };
    if (i === -1) list.push(folded); else list[i] = { ...list[i], ...folded };
  }
  // Provenance only. One worker serves every seat on this machine, so it cannot know which of them is "self":
  // that depends on which working tree is asking, and only the reader knows that. isSelf() decides it from the
  // reader's own identity. What the worker can say is which entries came off this disk rather than the network,
  // which is what lets a feature trust a sibling differently without weakening ADR-005 for anything remote.
  const device = localDevice || (ours[0] && ours[0].device) || null;
  for (let i = 0; i < list.length; i++) {
    list[i] = { ...list[i], local: Boolean(device && list[i].device === device) };
  }
  list.sort((a, b) => a.handle.localeCompare(b.handle) || a.device.localeCompare(b.device) || String(a.seat || '').localeCompare(String(b.seat || '')));
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    fetchedAt: new Date(now).toISOString(),
    transport: transport || { mode: 'local', lastErrorClass: null },
    writers: list,
  };
}

/** The snapshot to keep when a pull failed: the old one, restamped so staleness is honest about the failure. */
export function staleSnapshot(previous, transport, now = Date.now()) {
  if (!previous) return { schemaVersion: SNAPSHOT_SCHEMA_VERSION, fetchedAt: null, transport, writers: [] };
  return { ...previous, transport, staleSince: previous.fetchedAt || null, checkedAt: new Date(now).toISOString() };
}
