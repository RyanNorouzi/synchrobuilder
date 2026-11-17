// Lease refs (ADR-007): one ref per leased key on the remote, written with compare-and-swap.
//
// A git remote is already an atomic compare-and-swap store. A push names the value it expects a ref to have, and
// the server updates the ref only if that is still true, under its own ref lock. So "create this ref only if it
// does not exist" is an exclusive acquire that any number of machines can race for with exactly one winner, and
// "replace it only if it is still the commit I read" is a safe takeover. No server of our own is involved.
//
// The lease document is the commit message of a parentless commit on the empty tree, so writing one costs a
// single local git process before the push, which matters because acquire runs inside the pre-edit hook.
//
// Two rules this file exists to keep:
//   - Never put "+" on a push refspec. It turns the push into a forced one and git then skips the lease check
//     entirely; the push "succeeds" over a ref it should have lost to. Measured, not assumed.
//   - Everything read back is teammate data. decodeLease validates and drops; it never repairs.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRunner, initHidden } from './git-runner.mjs';
import { isHandle, isDevice, isSeat, validRepoPath, RE } from '../core/schema.mjs';
import { logLine } from '../core/log.mjs';
import { paths } from '../state/layout.mjs';

export const LEASE_NAMESPACE = 'refs/synchrobuilder/lease1';
export const LOCAL_LEASES = 'refs/sb-remote/lease1';
const HEADER = '[skip ci] synchrobuilder lease';
const MAX_DOC_CHARS = 2048;
const MAX_LISTED = 500;
const RE_HASH = /^[a-f0-9]{40}$/;

/** The ref-safe name of a lease key. Lower-cased before hashing so a case-insensitive machine and a
 *  case-sensitive one agree on which lease guards `Src/App.ts`; the cost is that two files differing only in
 *  case share a lease, which errs toward caution. */
export function leaseHash(key) {
  return crypto.createHash('sha256').update(String(key).normalize('NFC').toLowerCase()).digest('hex').slice(0, 40);
}

export function leaseRef(hash) { return `${LEASE_NAMESPACE}/${hash}`; }

function isoMs(s) { return typeof s === 'string' && RE.isoZ.test(s) ? Date.parse(s) : NaN; }

/** Validate a lease document from anywhere. Returns { handle, device, seat, path, at, exp, atMs, expMs } or null. */
export function validLease(raw, now = Date.now()) {
  if (!raw || typeof raw !== 'object' || raw.v !== 1) return null;
  if (!isHandle(raw.handle) || !isDevice(raw.device)) return null;
  if (raw.seat !== null && raw.seat !== undefined && !isSeat(raw.seat)) return null;
  const atMs = isoMs(raw.at);
  const expMs = isoMs(raw.exp);
  if (!Number.isFinite(atMs) || !Number.isFinite(expMs)) return null;
  // A lease that claims to expire more than a day out is not one this code would ever write. Refusing it keeps
  // a hostile or broken writer from holding a file for a year with a single push.
  if (expMs - now > 24 * 3600 * 1000) return null;
  const p = raw.path === undefined || raw.path === null ? null : validRepoPath(raw.path);
  return { handle: raw.handle, device: raw.device, seat: raw.seat || null, path: p, at: raw.at, exp: raw.exp, atMs, expMs };
}

export function encodeLease(doc) {
  return `${HEADER}\n\n${JSON.stringify({ v: 1, handle: doc.handle, device: doc.device, seat: doc.seat || null, path: doc.path || null, at: doc.at, exp: doc.exp })}\n`;
}

/** The lease document out of `git cat-file commit` output, or null. */
export function decodeLease(commitText, now = Date.now()) {
  const text = String(commitText || '');
  const blank = text.indexOf('\n\n');
  if (blank < 0) return null;
  const message = text.slice(blank + 2);
  const brace = message.indexOf('{');
  if (brace < 0) return null;
  const json = message.slice(brace).trim();
  if (json.length > MAX_DOC_CHARS) return null;
  try { return validLease(JSON.parse(json), now); } catch { return null; }
}

export class LeaseRefs {
  constructor({ remoteUrl, remoteDir, handle, runner = null, timeoutMs = 5000 } = {}) {
    this.remoteUrl = String(remoteUrl || '');
    this.repoDir = paths.remote(remoteDir).repo;
    this.runner = runner || createRunner({ repoDir: this.repoDir });
    this.handle = isHandle(handle) ? handle : 'synchrobuilder';
    this.timeoutMs = timeoutMs;
    this.emptyTree = null;
  }

  _ready() {
    if (!this.remoteUrl) return false;
    if (fs.existsSync(path.join(this.repoDir, 'HEAD'))) return true;
    return initHidden(this.repoDir).ok;
  }

  _emptyTree() {
    if (this.emptyTree) return this.emptyTree;
    const marker = path.join(this.repoDir, 'sb-empty-tree');
    try {
      const cached = fs.readFileSync(marker, 'utf8').trim();
      if (/^[0-9a-f]{40,64}$/.test(cached)) { this.emptyTree = cached; return cached; }
    } catch { /* not written yet */ }
    const r = this.runner.git(['mktree'], { input: '' });
    if (r.code !== 0) return null;
    this.emptyTree = r.stdout.trim();
    try { fs.writeFileSync(marker, this.emptyTree + '\n'); } catch { /* the marker only saves a process next time */ }
    return this.emptyTree;
  }

  _commit(doc) {
    const tree = this._emptyTree();
    if (!tree) return null;
    const email = `${this.handle}@synchrobuilder.invalid`;
    const env = { GIT_AUTHOR_NAME: this.handle, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: this.handle, GIT_COMMITTER_EMAIL: email };
    const r = this.runner.git(['commit-tree', tree, '-m', encodeLease(doc)], { env });
    return r.code === 0 ? r.stdout.trim() : null;
  }

  /**
   * Write the lease, but only if the remote ref is exactly `expect`: '' means "must not exist" (acquire), a sha
   * means "must still be the commit I read" (renew or take over).
   * Returns { ok: true, sha } | { ok: false, why: 'taken' } | { ok: false, why: 'error', errorClass }.
   */
  put(hash, doc, expect = '', { timeoutMs = this.timeoutMs } = {}) {
    try {
      if (!RE_HASH.test(hash) || !this._ready()) return { ok: false, why: 'error', errorClass: 'unknown' };
      const sha = this._commit(doc);
      if (!sha) return { ok: false, why: 'error', errorClass: 'unknown' };
      const ref = leaseRef(hash);
      const r = this.runner.git(['push', '--quiet', '--no-verify', `--force-with-lease=${ref}:${expect || ''}`, this.remoteUrl, `${sha}:${ref}`], { timeoutMs });
      if (r.code === 0) return { ok: true, sha };
      // A push that reached the server and was turned down means, in the case that matters, that someone else
      // got there first. Hosts word that differently ("stale info", "failed to update ref", "reference already
      // exists", a bare "remote rejected"), and reading a lost race as a transport error would let both sides
      // through. So anything that is not plainly the network or credentials is reported as 'taken', and the
      // caller settles it by reading the ref: if nothing is there after all, it was policy, not a race.
      if (!['network', 'auth', 'ssh-hostkey'].includes(r.errorClass) && !r.timedOut) return { ok: false, why: 'taken', errorClass: r.errorClass || 'unknown' };
      logLine('leases', `put ${hash.slice(0, 8)}: ${r.errorClass}`);
      return { ok: false, why: 'error', errorClass: r.errorClass || 'unknown' };
    } catch (err) {
      logLine('leases', `put threw: ${err && err.message}`);
      return { ok: false, why: 'error', errorClass: 'unknown' };
    }
  }

  /** Who holds it now. { ok: true, sha, doc } (doc null when unreadable), { ok: true, sha: null } when free, or { ok: false }. */
  read(hash, { timeoutMs = this.timeoutMs, now = Date.now() } = {}) {
    try {
      if (!RE_HASH.test(hash) || !this._ready()) return { ok: false, errorClass: 'unknown' };
      const local = `${LOCAL_LEASES}/${hash}`;
      const f = this.runner.git(['fetch', '--quiet', '--no-tags', this.remoteUrl, `+${leaseRef(hash)}:${local}`], { timeoutMs });
      if (f.code !== 0) {
        if (f.errorClass === 'no-ref') return { ok: true, sha: null, doc: null };
        return { ok: false, errorClass: f.errorClass || 'unknown' };
      }
      return this._readLocal(local, now);
    } catch (err) {
      logLine('leases', `read threw: ${err && err.message}`);
      return { ok: false, errorClass: 'unknown' };
    }
  }

  _readLocal(localRef, now) {
    const sha = this.runner.git(['rev-parse', '--verify', '--quiet', `${localRef}^{commit}`]);
    if (sha.code !== 0) return { ok: true, sha: null, doc: null };
    const body = this.runner.git(['cat-file', 'commit', sha.stdout.trim()], { maxBuffer: 64 * 1024 });
    return { ok: true, sha: sha.stdout.trim(), doc: body.code === 0 ? decodeLease(body.stdout, now) : null };
  }

  /** Delete the lease ref, but only if it is still `expect`. A lease someone else now holds is left alone. */
  remove(hash, expect, { timeoutMs = this.timeoutMs } = {}) {
    try {
      if (!RE_HASH.test(hash) || !expect || !this._ready()) return { ok: false, why: 'error' };
      const ref = leaseRef(hash);
      const r = this.runner.git(['push', '--quiet', '--no-verify', `--force-with-lease=${ref}:${expect}`, this.remoteUrl, `:${ref}`], { timeoutMs });
      if (r.code === 0) return { ok: true };
      // Already gone, or no longer ours: either way there is nothing left for this caller to release.
      if (r.errorClass === 'rejected' || r.errorClass === 'no-ref' || /remote ref does not exist|unable to delete/i.test(r.stderr)) return { ok: true, gone: true };
      return { ok: false, why: 'error', errorClass: r.errorClass || 'unknown' };
    } catch (err) {
      logLine('leases', `remove threw: ${err && err.message}`);
      return { ok: false, why: 'error' };
    }
  }

  /** Every lease on the remote, for the status view and for collecting the long dead. One fetch. */
  list({ timeoutMs = 20000, now = Date.now() } = {}) {
    try {
      if (!this._ready()) return { ok: false, leases: [] };
      const f = this.runner.git(['fetch', '--quiet', '--no-tags', '--prune', this.remoteUrl, `+${LEASE_NAMESPACE}/*:${LOCAL_LEASES}/*`], { timeoutMs });
      if (f.code !== 0) return { ok: false, leases: [], errorClass: f.errorClass || 'unknown' };
      // One process for every lease: the message body rides along in the listing. Fields are NUL-separated
      // because a commit message cannot contain a NUL, so a hostile body cannot forge a second record.
      const listed = this.runner.git(['for-each-ref', `--count=${MAX_LISTED}`, '--format=%(objectname)%00%(refname)%00%(contents:body)%00', LOCAL_LEASES]);
      if (listed.code !== 0) return { ok: false, leases: [] };
      const out = [];
      const fields = listed.stdout.split('\0');
      for (let i = 0; i + 2 < fields.length; i += 3) {
        const sha = fields[i].trim();
        const hash = fields[i + 1].slice(LOCAL_LEASES.length + 1);
        if (!/^[0-9a-f]{40,64}$/.test(sha) || !RE_HASH.test(hash)) continue;
        const body = fields[i + 2].trim();
        let doc = null;
        if (body.length <= MAX_DOC_CHARS) { try { doc = validLease(JSON.parse(body), now); } catch { doc = null; } }
        out.push({ hash, sha, doc });
      }
      return { ok: true, leases: out };
    } catch (err) {
      logLine('leases', `list threw: ${err && err.message}`);
      return { ok: false, leases: [] };
    }
  }
}
