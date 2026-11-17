// The lease table for one remote on this machine (ADR-007): <remoteDir>/leases/<hash>.json, one file per held key.
//
// Every working tree of this remote on this disk shares the directory, so it is where two agents in two
// worktrees find out about each other, in the time a file read takes. Each mutation runs under one short
// mutex. Without it a takeover is a read followed by a write, and an agent that judged a lease dead could
// overwrite the fresh lease a third agent had just taken in between. The mutex is held for microseconds and
// never across the network.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJsonAtomic } from '../core/fsx.mjs';
import { isHandle, isDevice, isSeat, validRepoPath, RE } from '../core/schema.mjs';
import { liveSessions } from '../state/sessions.mjs';
import { logLine } from '../core/log.mjs';

const LOCK_WAIT_MS = 400;
const LOCK_STALE_MS = 3000;
const RE_HASH = /^[a-f0-9]{40}$/;
const RE_SHA = /^[0-9a-f]{40,64}$/;

export function leasesDir(remoteDir) { return path.join(remoteDir, 'leases'); }
function fileOf(remoteDir, hash) { return path.join(leasesDir(remoteDir), `${hash}.json`); }
function iso(s) { return typeof s === 'string' && RE.isoZ.test(s) ? s : null; }
function sleepSync(ms) { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* spin instead */ } }

/** Run fn while holding the table mutex. Returns fn's value, or `fallback` when the mutex could not be had in time. */
export function withTable(remoteDir, fn, fallback = null) {
  const dir = leasesDir(remoteDir);
  const lock = path.join(dir, '.lock');
  try { fs.mkdirSync(dir, { recursive: true }); } catch { return fallback; }
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try { fs.mkdirSync(lock); break; } catch (err) {
      if (!err || err.code !== 'EEXIST') return fallback;
      // A holder that died inside the critical section leaves the directory behind. Nothing legitimate holds
      // it for more than a few milliseconds, so three seconds of age means abandoned.
      try { if (Date.now() - fs.statSync(lock).mtimeMs > LOCK_STALE_MS) { fs.rmdirSync(lock); continue; } } catch { continue; }
      if (Date.now() > deadline) { logLine('leases', 'table mutex busy; failing open'); return fallback; }
      sleepSync(5);
    }
  }
  try { return fn(); } finally { try { fs.rmdirSync(lock); } catch { /* already gone */ } }
}

/** Validate a record read from the table. This machine wrote it, but a half-written or foreign file must not count as a lease. */
export function validRecord(raw) {
  if (!raw || typeof raw !== 'object' || raw.v !== 1) return null;
  if (!isHandle(raw.handle) || !isDevice(raw.device)) return null;
  if (raw.seat !== null && !isSeat(raw.seat)) return null;
  const at = iso(raw.at);
  const touchedAt = iso(raw.touchedAt);
  if (!at || !touchedAt || typeof raw.nonce !== 'string' || typeof raw.checkoutDir !== 'string') return null;
  if (raw.state !== 'held' && raw.state !== 'releasing') return null;
  const p = validRepoPath(raw.path);
  if (!p) return null;
  let remote = null;
  if (raw.remote && typeof raw.remote === 'object' && RE_SHA.test(raw.remote.sha || '')) remote = { sha: raw.remote.sha, exp: iso(raw.remote.exp) };
  return {
    v: 1, nonce: raw.nonce.slice(0, 32), path: p, handle: raw.handle, device: raw.device, seat: raw.seat,
    sid: typeof raw.sid === 'string' ? raw.sid.slice(0, 64) : '', checkoutDir: raw.checkoutDir, at, touchedAt,
    state: raw.state, remote, contested: raw.contested === true,
  };
}

export function readRecord(remoteDir, hash) {
  return RE_HASH.test(hash) ? validRecord(readJson(fileOf(remoteDir, hash), null)) : null;
}

export function newRecord({ rel, identity, sid, checkoutDir, now, inherit = null }) {
  const t = new Date(now).toISOString();
  return {
    v: 1, nonce: crypto.randomBytes(8).toString('hex'), path: rel, handle: identity.handle, device: identity.device,
    seat: identity.seat || null, sid: sid || '', checkoutDir, at: t, touchedAt: t, state: 'held',
    // A lease taken over from a seat on this machine inherits that seat's remote ref, so the push that follows
    // can replace it by compare-and-swap instead of being refused by our own dead lease.
    remote: inherit && inherit.remote ? { sha: inherit.remote.sha, exp: null } : null,
    contested: false,
  };
}

/** Callers hold the mutex. */
export function writeRecord(remoteDir, hash, rec) { writeJsonAtomic(fileOf(remoteDir, hash), rec); }
export function deleteRecord(remoteDir, hash) { try { fs.unlinkSync(fileOf(remoteDir, hash)); return true; } catch { return false; } }

/** Patch a record only if it is still the one the caller took (same nonce). Returns the new record or null. */
export function patchRecord(remoteDir, hash, nonce, patch) {
  return withTable(remoteDir, () => {
    const cur = readRecord(remoteDir, hash);
    if (!cur || cur.nonce !== nonce) return null;
    const next = { ...cur, ...patch };
    writeRecord(remoteDir, hash, next);
    return next;
  }, null);
}

export function dropRecord(remoteDir, hash, nonce) {
  return withTable(remoteDir, () => {
    const cur = readRecord(remoteDir, hash);
    if (!cur || cur.nonce !== nonce) return false;
    return deleteRecord(remoteDir, hash);
  }, false);
}

/** Every record in the table, each with its hash. No mutex: a listing is advisory. */
export function listRecords(remoteDir) {
  let names = [];
  try { names = fs.readdirSync(leasesDir(remoteDir)).filter((n) => n.endsWith('.json')); } catch { return []; }
  const out = [];
  for (const n of names.slice(0, 2000)) {
    const hash = n.slice(0, -5);
    const rec = readRecord(remoteDir, hash);
    if (rec) out.push({ hash, ...rec });
  }
  return out;
}

export function sameSeat(rec, identity) {
  return Boolean(rec && identity && rec.handle === identity.handle && rec.device === identity.device && (rec.seat || null) === (identity.seat || null));
}

/** Is the session that took this lease still running? A lease with no session id counts while any session in that tree is live. */
export function holderSessionLive(rec) {
  try {
    const live = liveSessions(rec.checkoutDir);
    return rec.sid ? live.some((s) => s.sessionId === rec.sid) : live.length > 0;
  } catch { return false; }
}

/** A lease another agent on this machine can be refused over: held, touched recently, and its session is alive. */
export function recordLive(rec, now, idleMs) {
  if (!rec || rec.state !== 'held') return false;
  const touched = Date.parse(rec.touchedAt);
  if (!Number.isFinite(touched) || now - touched > idleMs) return false;
  return holderSessionLive(rec);
}

/**
 * Mark this seat's leases as released. A lease with a remote ref becomes 'releasing' so the worker can delete
 * the ref; one without is simply removed. No network here: session-end has a second to live.
 */
export function releaseRecords(remoteDir, predicate) {
  return withTable(remoteDir, () => {
    let n = 0;
    for (const rec of listRecords(remoteDir)) {
      if (!predicate(rec)) continue;
      const { hash, ...body } = rec;
      if (body.remote) writeRecord(remoteDir, hash, { ...body, state: 'releasing' });
      else deleteRecord(remoteDir, hash);
      n += 1;
    }
    return n;
  }, 0);
}
