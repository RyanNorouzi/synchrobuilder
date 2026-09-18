// Turn the writers a pull returned into snapshot.json, the single local file every hook reads (ADR-001 section 2).
// The reader's clock decides freshness: firstSeenAt is when THIS machine first saw a given (handle, device, sha),
// so a teammate with a wrong clock can neither look permanently online nor expire early.
import { SNAPSHOT_SCHEMA_VERSION } from '../state/layout.mjs';
import { parseWriters } from '../transport/reader.mjs';

/** Carry firstSeenAt forward for writers whose commit we have already seen. */
export function carryFirstSeen(entries, previous) {
  const seen = new Map();
  for (const w of (previous && Array.isArray(previous.writers) ? previous.writers : [])) {
    if (w && w.handle && w.device && w.sha && w.firstSeenAt) seen.set(`${w.handle}/${w.device}/${w.sha}`, w.firstSeenAt);
  }
  return entries.map((e) => {
    const known = seen.get(`${e.handle}/${e.device}/${e.sha}`);
    return known ? { ...e, firstSeenAt: known } : e;
  });
}

/**
 * Build the snapshot. `ownEntry` is this developer's own state, folded in so the status command and the
 * status line can show it without a round trip through the remote.
 */
export function foldSnapshot({ writers, previous = null, team = null, own = null, transport = null, now = Date.now() }) {
  const parsed = carryFirstSeen(parseWriters(writers, { team, receiptMs: now }), previous);
  const list = [...parsed];
  if (own && own.handle && own.device) {
    const i = list.findIndex((w) => w.handle === own.handle && w.device === own.device);
    const entry = { ...own, self: true, verified: 'yes', firstSeenAt: new Date(now).toISOString() };
    if (i === -1) list.push(entry); else list[i] = { ...list[i], ...entry };
  }
  list.sort((a, b) => a.handle.localeCompare(b.handle) || a.device.localeCompare(b.device));
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
