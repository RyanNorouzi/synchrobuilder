// Shared helpers for the multiplayer features: identity, snapshot loading with re-validation, staleness tiers, path matching.
// Everything here is file reads only and never throws, because most callers run inside a hook (ADR-003 fail-open contract).
import path from 'node:path';
import { readJson } from '../core/fsx.mjs';
import { toRepoRelative, CASE_INSENSITIVE, canonicalPath, toPosix, locate } from '../core/paths.mjs';
import { readConfig, readTeam } from '../core/config.mjs';
import {
  isHandle, isDevice, isSeat, validRepoPath, validTimestamp, validPresence, validClaims, validMessage, validBoard, validHandoff, validContracts,
} from '../core/schema.mjs';

export const MS = Object.freeze({ minute: 60_000, hour: 3_600_000, day: 86_400_000 });
const VERIFIED = new Set(['yes', 'unknown-handle', 'email-mismatch', 'manifest-mismatch']);

/** Tests pass ctx.now (ms) so timings are deterministic; hooks use the wall clock. */
export function nowMs(ctx) { return ctx && Number.isFinite(ctx.now) ? ctx.now : Date.now(); }

/** Who this working tree is. The seat is the checkout directory's own name, which workspaceKey() derived from
 *  this tree's git dir, so it needs no extra file and cannot drift from the directory it describes. Without it
 *  every hook would fail to recognise its own writer entry and would treat itself as a teammate. */
export function readIdentity(checkoutDir) {
  const raw = checkoutDir ? readJson(path.join(checkoutDir, 'identity.json'), null) : null;
  if (!raw || !isHandle(raw.handle) || !isDevice(raw.device)) return null;
  const fromDir = path.basename(String(checkoutDir));
  return {
    handle: raw.handle,
    device: raw.device,
    seat: isSeat(fromDir) ? fromDir : null,
    source: typeof raw.source === 'string' ? raw.source.slice(0, 20) : 'unknown',
  };
}

/** Staleness ladder (ADR-001 section 6) for any age: fresh < 5 min, recent < 15 min, stale < 24 h, gone. */
export function tierOf(ageMs) {
  if (!Number.isFinite(ageMs)) return 'gone';
  if (ageMs < 5 * MS.minute) return 'fresh';
  if (ageMs < 15 * MS.minute) return 'recent';
  if (ageMs < MS.day) return 'stale';
  return 'gone';
}

function parseMs(iso) { const t = iso ? Date.parse(iso) : NaN; return Number.isFinite(t) ? t : NaN; }

/** Optional per-writer recent edits: [{ path, at }]. Not part of the core validators yet, so validated here. */
function validEdits(v, now) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const e of v.slice(0, 100)) {
    if (!e || typeof e !== 'object') continue;
    const p = validRepoPath(e.path);
    const at = validTimestamp(e.at, now);
    if (p && at) out.push({ path: p, at });
    if (out.length >= 50) break;
  }
  return out;
}

/** Re-validates a parsed snapshot.json. The worker validated on ingest, but the snapshot is still teammate data. */
export function normalizeSnapshot(raw, now = Date.now()) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.writers)) return null;
  const fetchedAt = validTimestamp(raw.fetchedAt, now);
  const fetchedMs = parseMs(fetchedAt);
  const writers = [];
  for (const w of raw.writers.slice(0, 200)) {
    if (!w || typeof w !== 'object' || !isHandle(w.handle) || !isDevice(w.device)) continue;
    writers.push({
      handle: w.handle, device: w.device, seat: isSeat(w.seat) ? w.seat : null, local: w.local === true,
      sha: typeof w.sha === 'string' ? w.sha.slice(0, 40) : null,
      firstSeenAt: validTimestamp(w.firstSeenAt, now), verified: VERIFIED.has(w.verified) ? w.verified : 'unknown-handle',
      presence: validPresence(w.presence, now), claims: validClaims(w.claims, now),
      messages: Array.isArray(w.messages) ? w.messages.map((m) => validMessage(m, now)).filter(Boolean).slice(0, 100) : [],
      handoffs: Array.isArray(w.handoffs) ? w.handoffs.map((h) => validHandoff(h, now)).filter(Boolean).slice(0, 20) : [],
      board: validBoard(w.board, now), contracts: validContracts(w.contracts, now), edits: validEdits(w.edits, now),
    });
  }
  const ageMs = Number.isFinite(fetchedMs) ? Math.max(0, now - fetchedMs) : NaN;
  const transport = raw.transport && typeof raw.transport === 'object' ? raw.transport : {};
  return { fetchedAt, ageMs, tier: tierOf(ageMs), transport, writers };
}

export function loadSnapshot(file, now = Date.now()) {
  return file ? normalizeSnapshot(readJson(file, null), now) : null;
}

/** ctx.snapshot (provided by the hook) wins; otherwise read ctx.snapshotFile. Always returns a normalized snapshot or null. */
export function snapshotFromCtx(ctx) {
  const now = nowMs(ctx);
  if (ctx && ctx.snapshot && typeof ctx.snapshot === 'object') {
    return Array.isArray(ctx.snapshot.writers) && 'ageMs' in ctx.snapshot ? ctx.snapshot : normalizeSnapshot(ctx.snapshot, now);
  }
  return loadSnapshot(ctx && ctx.snapshotFile, now);
}

/** "Self" is one seat, not one machine.
 *
 *  Before seats existed this compared handle and device only, which meant two agents in two worktrees of one
 *  clone matched as the same person and each filtered the other out of their own view. Comparing the seat as
 *  well is what makes sibling agents visible to each other. A writer with no seat comes from a client older
 *  than seats; its null is a distinct value and only ever matches another null. */
export function isSelf(writer, identity) {
  if (!identity) return false;
  if (writer.handle !== identity.handle || writer.device !== identity.device) return false;
  // When either side predates seats, fall back to the old handle-and-device rule. That covers the upgrade
  // window in both directions: a ref this machine published before seats existed, and local state that has
  // not been re-resolved yet. Treating those as a stranger would show a developer their own work as a
  // teammate's, which is worse than briefly under-reporting a sibling.
  if (!writer.seat || !identity.seat) return true;
  return writer.seat === identity.seat;
}

/** Everyone except me: other people, and other seats of mine on this machine. */
export function teammates(snapshot, identity) {
  return snapshot ? snapshot.writers.filter((w) => !isSelf(w, identity)) : [];
}

/** Teammates sharing this machine: another working tree of the same clone, or another clone on this disk.
 *  Their state is on one filesystem with ours, so it can be read without waiting for a remote round trip. */
export function siblings(snapshot, identity) {
  if (!identity) return [];
  return teammates(snapshot, identity).filter((w) => w.device === identity.device);
}

/** Teammates on other machines, which is the only traffic that ever crossed the network. */
export function remoteWriters(snapshot, identity) {
  if (!identity) return teammates(snapshot, identity);
  return teammates(snapshot, identity).filter((w) => w.device !== identity.device);
}

/** Age of a writer's presence: the older of "when we first saw this state" and "when they say they were last active". */
export function presenceAgeMs(writer, now) {
  const seen = parseMs(writer.presence && writer.presence.lastSeen);
  const first = parseMs(writer.firstSeenAt);
  const ages = [seen, first].filter(Number.isFinite).map((t) => Math.max(0, now - t));
  return ages.length ? Math.max(...ages) : NaN;
}

export function claimAgeMs(claim, writer, now) {
  const at = Number.isFinite(parseMs(claim.at)) ? parseMs(claim.at) : parseMs(writer.firstSeenAt);
  return Number.isFinite(at) ? Math.max(0, now - at) : NaN;
}

export function claimActive(claim, writer, now) {
  const age = claimAgeMs(claim, writer, now);
  return Number.isFinite(age) && age < claim.ttlMs;
}

export function samePath(a, b) { return CASE_INSENSITIVE ? a.toLowerCase() === b.toLowerCase() : a === b; }

/** True when `ancestor` is the path itself or one of its parent directories. */
export function coversPath(ancestor, p) {
  const A = CASE_INSENSITIVE ? ancestor.toLowerCase() : ancestor;
  const P = CASE_INSENSITIVE ? p.toLowerCase() : p;
  return A === P || P.startsWith(A + '/');
}

export function pathsOverlap(a, b) { return coversPath(a, b) || coversPath(b, a); }

/** Repo-relative POSIX path for a tool_input file path (absolute, relative to cwd, backslashes accepted). Null outside the work tree. */
export function repoRelativePath(loc, cwd, filePath) {
  if (!loc) return null;
  const rel = toRepoRelative(loc.workTree, filePath, cwd);
  return rel ? validRepoPath(rel) : null;
}

export function fmtAgo(ms) {
  if (!Number.isFinite(ms)) return 'at an unknown time';
  if (ms < MS.minute) return 'just now';
  if (ms < MS.hour) return `${Math.floor(ms / MS.minute)} min ago`;
  if (ms < MS.day) return `${Math.floor(ms / MS.hour)} h ago`;
  return `${Math.floor(ms / MS.day)} d ago`;
}

export function fmtShortAge(ms) {
  if (!Number.isFinite(ms)) return '?';
  if (ms < MS.minute) return 'now';
  if (ms < MS.hour) return `${Math.floor(ms / MS.minute)}m`;
  if (ms < MS.day) return `${Math.floor(ms / MS.hour)}h`;
  return `${Math.floor(ms / MS.day)}d`;
}

export function hhmmZ(iso) { const t = parseMs(iso); return Number.isFinite(t) ? new Date(t).toISOString().slice(11, 16) + 'Z' : '??:??Z'; }

/** Printable ASCII only, for anything we print to a terminal from teammate fields (ADR-005 section 4). */
export function terminalSafe(text, max = 60) {
  // Whole escape sequences go first (CSI, OSC, two-byte ESC forms), then anything outside printable ASCII.
  const s = String(text ?? '').replace(/\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b./g, '').replace(/[^\x20-\x7e]/g, '').replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1) + '~' : s;
}

/** Everything a CLI command needs about the current checkout, resolved from cwd by file reads only. */
export function resolveContext(cwd, now = Date.now()) {
  const loc = locate(cwd);
  if (!loc) return null;
  const snapshotFile = loc.remoteDir ? path.join(loc.remoteDir, 'snapshot.json') : null;
  return {
    cwd, loc, now, checkoutDir: loc.checkoutDir, snapshotFile,
    statusFile: loc.remoteDir ? path.join(loc.remoteDir, 'status.json') : null,
    identity: readIdentity(loc.checkoutDir), snapshot: loadSnapshot(snapshotFile, now),
    config: readConfig(loc.workTree), team: readTeam(loc.workTree),
  };
}
