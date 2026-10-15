// Same-machine coordination between seats: the fast path.
//
// Two agents in two worktrees of one clone publish to the same remote, but they also sit on one filesystem.
// Waiting for a claim to travel journal -> worker -> push -> fetch -> snapshot costs a sync interval, which is
// 45 to 60 seconds. For a human typing that is invisible. For two agents editing in the same second it is the
// difference between coordinating and colliding.
//
// So a sibling's state is read straight off the disk it is already on. Nothing here touches the network, and
// nothing here loosens ADR-005: this path only ever reads state that THIS machine wrote. Anything that arrived
// over the network still comes through the snapshot and is still treated as untrusted data.
import fs from 'node:fs';
import path from 'node:path';
import { readJson } from '../core/fsx.mjs';
import { validClaims, validPresence, isSeat } from '../core/schema.mjs';
import { liveSessions } from '../state/sessions.mjs';
import { logLine } from '../core/log.mjs';
import { readEvents } from '../state/journal.mjs';
import { foldClaims } from '../state/own.mjs';

/** Every seat registered against this remote on this machine, this one included. */
export function readSeats(remoteDir) {
  if (!remoteDir) return [];
  const out = [];
  const seen = new Set();
  const take = (c) => {
    if (!c || typeof c.checkoutDir !== 'string' || seen.has(c.checkoutDir)) return;
    seen.add(c.checkoutDir);
    const seat = isSeat(c.seat) ? c.seat : (isSeat(path.basename(c.checkoutDir)) ? path.basename(c.checkoutDir) : null);
    out.push({ checkoutDir: c.checkoutDir, workTree: c.workTree || null, seat });
  };
  const legacy = readJson(path.join(remoteDir, 'checkouts.json'), null);
  for (const c of (legacy && Array.isArray(legacy.checkouts) ? legacy.checkouts : [])) take(c);
  let names = [];
  try { names = fs.readdirSync(path.join(remoteDir, 'checkouts')).filter((n) => n.endsWith('.json')); } catch { names = []; }
  for (const n of names) take(readJson(path.join(remoteDir, 'checkouts', n), null));
  return out.slice(0, 64);
}

/**
 * What the other seats on this machine are holding right now, read from their own/ directories rather than
 * from the shared snapshot. Each entry is shaped like a snapshot writer so the collision and digest code can
 * treat it the same way, and is marked `local` and `live` so a caller can tell a running agent from a
 * worktree whose session has ended.
 */
export function siblingWriters(loc, identity, now = Date.now()) {
  if (!loc || !loc.remoteDir || !identity) return [];
  const mySeat = identity.seat || (loc.checkoutDir ? path.basename(loc.checkoutDir) : null);
  const out = [];
  for (const seat of readSeats(loc.remoteDir)) {
    if (!seat.seat || seat.seat === mySeat) continue;
    if (seat.checkoutDir === loc.checkoutDir) continue;
    const presence = validPresence(readJson(path.join(seat.checkoutDir, 'own', 'presence.json'), null), now);
    // Fold the sibling's journal rather than reading its published own/claims.json. The journal is appended
    // the instant a claim is made; own/ is only rewritten on the next worker tick. Reading the journal is what
    // turns "sees it within a sync interval" into "sees it within milliseconds", which is the whole point.
    let claims = [];
    try {
      claims = foldClaims(readEvents(seat.checkoutDir), now) || [];
    } catch (err) {
      // Falling back to the published copy is correct, but doing it silently once hid a real failure on one
      // CI platform for a whole run: the warning simply never appeared and nothing said why.
      logLine('features', `sibling journal fold failed for ${seat.seat}: ${err && err.message}`);
      claims = validClaims(readJson(path.join(seat.checkoutDir, 'own', 'claims.json'), null), now) || [];
    }
    if (!presence && !claims.length) continue;
    let live = false;
    try { live = liveSessions(seat.checkoutDir).length > 0; } catch { live = false; }
    out.push({
      handle: (presence && presence.handle) || identity.handle,
      device: (presence && presence.device) || identity.device,
      seat: seat.seat,
      workTree: seat.workTree,
      // Written by this machine, so it is as trustworthy as our own state and needs no verification label.
      verified: 'yes',
      local: true,
      live,
      firstSeenAt: new Date(now).toISOString(),
      presence: presence || null,
      claims,
      messages: [], handoffs: [], board: [], contracts: [],
      edits: (presence && presence.edits) || [],
    });
  }
  return out;
}

/**
 * The snapshot a hook should reason about: what the remote told us, with same-machine seats replaced by what
 * they are holding at this instant. A sibling that has published is overwritten rather than duplicated, so a
 * stale copy of a sibling from the last fetch never wins over the live one on disk.
 */
export function withSiblings(snapshot, loc, identity, now = Date.now()) {
  const live = siblingWriters(loc, identity, now);
  if (!live.length) return snapshot;
  const base = snapshot && Array.isArray(snapshot.writers) ? snapshot : { writers: [], tier: 'fresh', ageMs: 0, fetchedAt: null, transport: {} };
  const bySeat = new Map(live.map((w) => [`${w.handle}/${w.device}/${w.seat}`, w]));
  const merged = base.writers.map((w) => {
    const hit = bySeat.get(`${w.handle}/${w.device}/${w.seat}`);
    if (!hit) return w;
    bySeat.delete(`${w.handle}/${w.device}/${w.seat}`);
    return { ...w, ...hit };
  });
  for (const w of bySeat.values()) merged.push(w);
  // A sibling read off this disk is current by definition, so a snapshot carrying one is never stale.
  return { ...base, writers: merged, tier: 'fresh', ageMs: 0 };
}
