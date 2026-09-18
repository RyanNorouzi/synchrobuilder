// GitRefsTransport (ADR-001 sections 1-4): one parentless snapshot commit per (handle, device) ref, pushed with a lease and
// never with bare --force; fallback to fast-forward branches when the host rejects the custom namespace; a reader that fetches
// both namespaces into distinct local namespaces and validates every path, mode and size before a byte reaches the caller.
// Every public method catches its own errors and reports through the returned status; nothing here reads the user's repository.
import fs from 'node:fs';
import path from 'node:path';
import { Transport, REF_NAMESPACE, BRANCH_NAMESPACE, LOCAL_CUSTOM, LOCAL_HEADS } from './interface.mjs';
import { createRunner, initHidden, firstLine, parseLsRemote, parseForEachRef, parseLsTree, parseBatchCheck, parseCatFileBatch, FOR_EACH_REF_FORMAT } from './git-runner.mjs';
import { LIMITS, SCHEMA_VERSION, isHandle, isDevice, validRepoPath, nowIso } from '../core/schema.mjs';
import { logLine } from '../core/log.mjs';
import { redact } from '../safety/redact.mjs';
import { paths } from '../state/layout.mjs';

export const MODES = Object.freeze(['custom', 'branch', 'readonly', 'local']);
// The only file names a writer may publish and a reader will accept (ADR-001 section 1).
export const ALLOWED_FILE = /^(?:manifest|presence|claims|board|contracts)\.json$|^(?:messages|handoffs)\/[0-9A-HJKMNP-TV-Z]{26}\.json$/;
const BLOB_MODES = new Set(['100644', '100755']);
const TREE_BYTES = LIMITS.blobBytes;   // a legitimate writer's top tree is a few hundred bytes; 64 KB already means thousands of entries
const MAX_WRITERS = 500;               // bounds the per-tick work against a remote flooded with refs
const BACKOFF = Object.freeze({ minMs: 30000, maxMs: 600000, authMs: 900000 });

/** A state file name is a valid repo path AND one of the allowed names. Returns the NFC path or null. */
export function allowedStatePath(p) {
  const v = validRepoPath(p);
  return v && ALLOWED_FILE.test(v) ? v : null;
}

/** Parse a local mirror ref into { handle, device, namespace } or null when it is not a well-formed writer ref. */
export function parseWriterRef(ref) {
  const ns = ref.startsWith(`${LOCAL_CUSTOM}/`) ? 'custom' : ref.startsWith(`${LOCAL_HEADS}/`) ? 'branch' : null;
  if (!ns) return null;
  const rest = ref.slice((ns === 'custom' ? LOCAL_CUSTOM : LOCAL_HEADS).length + 1).split('/');
  if (rest.length !== 2 || !isHandle(rest[0]) || !isDevice(rest[1])) return null;
  return { handle: rest[0], device: rest[1], namespace: ns };
}

export class GitRefsTransport extends Transport {
  constructor({ remoteUrl, remoteDir, handle, device, mode = 'custom', lastKnownSha = {}, authorEmail = null, runner = null } = {}) {
    super();
    this.remoteUrl = String(remoteUrl || '');
    this.remoteDir = remoteDir;
    this.handle = handle;
    this.device = device;
    this.mode = MODES.includes(mode) ? mode : 'custom';
    this.repoDir = paths.remote(remoteDir).repo;
    this.runner = runner || createRunner({ repoDir: this.repoDir });
    // Real-email authorship is an opt-in for hosts with author rules (ADR-001 section 1); the default never leaves the machine.
    this.authorEmail = typeof authorEmail === 'string' && /^[^\s@]+@[^\s@]+$/.test(authorEmail) ? authorEmail : `${handle}@synchrobuilder.invalid`;
    this.lastKnownSha = { ...(lastKnownSha && typeof lastKnownSha === 'object' ? lastKnownSha : {}) };
    this.failures = 0;
    this.hadRefs = false;
    this.cache = new Map();
    this._status = { mode: this.mode, lastError: null, lastErrorClass: null, lastOkAt: null, nextAttemptAt: null };
  }

  get customRef() { return `${REF_NAMESPACE}/${this.handle}/${this.device}`; }
  get branchRef() { return `${BRANCH_NAMESPACE}/${this.handle}/${this.device}`; }

  status() { return { ...this._status, mode: this.mode, lastKnownSha: { ...this.lastKnownSha } }; }

  // ---- status bookkeeping -------------------------------------------------------------------------------------------

  _ok() {
    this.failures = 0;
    this._status = { ...this._status, mode: this.mode, lastError: null, lastErrorClass: null, lastOkAt: nowIso(), nextAttemptAt: null };
    return this.status();
  }

  _fail(errorClass, text) {
    this.failures += 1;
    const wait = errorClass === 'auth' ? BACKOFF.authMs : Math.min(BACKOFF.minMs * 2 ** (this.failures - 1), BACKOFF.maxMs);
    const lastError = redact(firstLine(text) || errorClass).text.slice(0, 300);
    this._status = { ...this._status, mode: this.mode, lastError, lastErrorClass: errorClass || 'unknown', nextAttemptAt: new Date(Date.now() + wait).toISOString() };
    logLine('transport', `${this.handle}/${this.device} ${errorClass}: ${lastError}`);
    return this.status();
  }

  _failRun(r) { return this._fail(r.errorClass || 'unknown', r.stderr || r.error || r.stdout); }

  _ensureRepo() {
    if (fs.existsSync(path.join(this.repoDir, 'HEAD'))) return true;
    const r = initHidden(this.repoDir);
    if (!r.ok) this._fail('unknown', `hidden repo: ${r.detail}`);
    return r.ok;
  }

  // ---- probe ----------------------------------------------------------------------------------------------------------

  async probe() {
    try {
      if (!this.remoteUrl) { this.mode = 'local'; return { mode: 'local', detail: 'no remote url' }; }
      if (!this._ensureRepo()) return { mode: this.mode, detail: this._status.lastError };
      const r = this.runner.git(['ls-remote', '--quiet', this.remoteUrl, `${REF_NAMESPACE}/*`]);
      if (r.code !== 0) {
        const st = this._failRun(r);
        // Reading failed, so neither pull nor publish can work; keep the configured mode for when the remote comes back.
        return { mode: st.lastErrorClass === 'auth' ? 'readonly' : this.mode, detail: `${st.lastErrorClass}: ${st.lastError}` };
      }
      const refs = Object.keys(parseLsRemote(r.stdout)).length;
      this._ok();
      if (this.mode === 'readonly' || this.mode === 'local') this.mode = 'custom';
      return { mode: this.mode, detail: `ls-remote ok, ${refs} custom refs` };
    } catch (err) {
      return { mode: this.mode, detail: this._fail('unknown', err && err.message).lastError };
    }
  }

  // ---- publish --------------------------------------------------------------------------------------------------------

  async publish(tree) {
    try {
      if (this.mode === 'readonly' || this.mode === 'local') {
        this._status.lastError = `publishing disabled in ${this.mode} mode`;
        return { ok: false, sha: null, ref: null, mode: this.mode, status: this.status() };
      }
      if (!this._ensureRepo()) return { ok: false, sha: null, ref: null, mode: this.mode, status: this.status() };
      const treeSha = this._buildTree(this._normalizeTree(tree));
      if (!treeSha) return { ok: false, sha: null, ref: null, mode: this.mode, status: this.status() };
      if (this.mode === 'custom') {
        const r = this._pushCustom(treeSha);
        if (r.ok) return r;
        if (!['policy', 'no-ref'].includes(r.status.lastErrorClass)) return r;
        logLine('transport', `custom namespace rejected (${r.status.lastErrorClass}); switching to branch mode`);
        this.mode = 'branch';
      }
      return this._pushBranch(treeSha);
    } catch (err) {
      return { ok: false, sha: null, ref: null, mode: this.mode, status: this._fail('unknown', err && err.message) };
    }
  }

  /** Coerce the caller's tree into { relPath: Buffer }, dropping anything a reader would reject, and add the manifest. */
  _normalizeTree(tree) {
    const files = {};
    let count = 0;
    for (const [rel, value] of Object.entries(tree && typeof tree === 'object' ? tree : {})) {
      const p = allowedStatePath(rel);
      const buf = Buffer.isBuffer(value) ? value : typeof value === 'string' ? Buffer.from(value, 'utf8') : null;
      if (!p || !buf) { logLine('transport', `publish: dropped invalid entry ${JSON.stringify(rel).slice(0, 80)}`); continue; }
      if (buf.length > LIMITS.blobBytes) { logLine('transport', `publish: dropped ${p} (${buf.length} bytes over cap)`); continue; }
      if (count >= LIMITS.filesPerWriter) { logLine('transport', `publish: dropped ${p} (file cap)`); continue; }
      files[p] = buf;
      count += 1;
    }
    if (!files['manifest.json']) files['manifest.json'] = Buffer.from(JSON.stringify({ handle: this.handle, device: this.device, schemaVersion: SCHEMA_VERSION }) + '\n');
    return files;
  }

  /** hash-object per file, mktree per directory (messages/, handoffs/) then the root. Returns the root tree sha or null. */
  _buildTree(files) {
    const dirs = { '': [] };
    for (const [rel, buf] of Object.entries(files)) {
      const r = this.runner.git(['hash-object', '-w', '--no-filters', '--stdin'], { input: buf });
      if (r.code !== 0) { this._failRun(r); return null; }
      const slash = rel.indexOf('/');
      const dir = slash < 0 ? '' : rel.slice(0, slash);
      (dirs[dir] = dirs[dir] || []).push(`100644 blob ${r.stdout.trim()}\t${slash < 0 ? rel : rel.slice(slash + 1)}`);
    }
    for (const dir of Object.keys(dirs).filter(Boolean)) {
      const r = this.runner.git(['mktree'], { input: dirs[dir].join('\n') + '\n' });
      if (r.code !== 0) { this._failRun(r); return null; }
      dirs[''].push(`040000 tree ${r.stdout.trim()}\t${dir}`);
    }
    const root = this.runner.git(['mktree'], { input: dirs[''].join('\n') + '\n' });
    if (root.code !== 0) { this._failRun(root); return null; }
    return root.stdout.trim();
  }

  _commit(treeSha, parent) {
    const env = { GIT_AUTHOR_NAME: this.handle, GIT_AUTHOR_EMAIL: this.authorEmail, GIT_COMMITTER_NAME: this.handle, GIT_COMMITTER_EMAIL: this.authorEmail };
    const args = ['commit-tree', treeSha, ...(parent ? ['-p', parent] : []), '-m', `[skip ci] synchrobuilder state ${this.handle}/${this.device}`];
    const r = this.runner.git(args, { env });
    if (r.code !== 0) { this._failRun(r); return null; }
    return r.stdout.trim();
  }

  _published(ref, sha) {
    this.lastKnownSha[ref] = sha;
    return { ok: true, sha, ref, mode: this.mode, lastKnownSha: { ...this.lastKnownSha }, status: this._ok() };
  }

  _unpublished(ref, r) { return { ok: false, sha: null, ref, mode: this.mode, lastKnownSha: { ...this.lastKnownSha }, status: this._failRun(r) }; }

  /** Current remote sha of one ref via ls-remote: a sha, '' when absent, or null when the listing itself failed. */
  _remoteSha(ref) {
    const r = this.runner.git(['ls-remote', '--quiet', this.remoteUrl, ref]);
    if (r.code !== 0) return null;
    return parseLsRemote(r.stdout)[ref] || '';
  }

  _pushCustom(treeSha) {
    const ref = this.customRef;
    const sha = this._commit(treeSha, null);
    if (!sha) return { ok: false, sha: null, ref, mode: this.mode, status: this.status() };
    const attempt = (lease) => this.runner.git(['push', '--quiet', '--no-verify', `--force-with-lease=${ref}:${lease}`, this.remoteUrl, `${sha}:${ref}`]);
    let r = attempt(this.lastKnownSha[ref] || '');
    if (r.code === 0) return this._published(ref, sha);
    if (r.errorClass === 'rejected') {
      // Someone (a force push, a mirror wipe) moved our ref: lease on what the remote has now and try exactly once more.
      const remote = this._remoteSha(ref);
      if (remote !== null) {
        r = attempt(remote);
        if (r.code === 0) return this._published(ref, sha);
      }
    }
    return this._unpublished(ref, r);
  }

  /** Branch mode: parented fast-forward commits, never forced; -o ci.skip when the server accepts push options. */
  _pushBranch(treeSha) {
    const ref = this.branchRef;
    const attempt = (parent) => {
      if (parent && !this._haveCommit(parent) && !this._fetchOne(ref)) parent = null;
      if (parent && !this._haveCommit(parent)) parent = null;
      const sha = this._commit(treeSha, parent);
      if (!sha) return { sha: null, r: null };
      let r = this.runner.git(['push', '--quiet', '--no-verify', '-o', 'ci.skip', this.remoteUrl, `${sha}:${ref}`]);
      if (r.code !== 0 && /does not support push options/i.test(r.stderr)) r = this.runner.git(['push', '--quiet', '--no-verify', this.remoteUrl, `${sha}:${ref}`]);
      return { sha, r };
    };
    let { sha, r } = attempt(this.lastKnownSha[ref] || null);
    if (!r) return { ok: false, sha: null, ref, mode: this.mode, status: this.status() };
    if (r.code === 0) return this._published(ref, sha);
    if (r.errorClass === 'rejected') {
      const remote = this._remoteSha(ref);
      if (remote) {
        ({ sha, r } = attempt(remote));
        if (!r) return { ok: false, sha: null, ref, mode: this.mode, status: this.status() };
        if (r.code === 0) return this._published(ref, sha);
      }
    }
    return this._unpublished(ref, r);
  }

  _haveCommit(sha) { return this.runner.git(['cat-file', '-e', `${sha}^{commit}`]).code === 0; }

  _fetchOne(ref) {
    const local = ref.startsWith(`${BRANCH_NAMESPACE}/`) ? `${LOCAL_HEADS}/${ref.slice(BRANCH_NAMESPACE.length + 1)}` : `${LOCAL_CUSTOM}/${ref.slice(REF_NAMESPACE.length + 1)}`;
    return this.runner.git(['fetch', '--quiet', '--no-tags', this.remoteUrl, `+${ref}:${local}`]).code === 0;
  }

  // ---- pull -----------------------------------------------------------------------------------------------------------

  async pull() {
    try {
      if (this.mode === 'local' || !this.remoteUrl) return { ok: false, writers: [], status: this.status() };
      if (!this._ensureRepo()) return { ok: false, writers: [], status: this.status() };
      const f = this.runner.git(['fetch', '--quiet', '--no-tags', '--prune', this.remoteUrl, `+${REF_NAMESPACE}/*:${LOCAL_CUSTOM}/*`, `+${BRANCH_NAMESPACE}/*:${LOCAL_HEADS}/*`]);
      if (f.code !== 0) return { ok: false, writers: [], status: this._failRun(f) };
      const listed = this.runner.git(['for-each-ref', `--format=${FOR_EACH_REF_FORMAT}`, LOCAL_CUSTOM, LOCAL_HEADS]);
      if (listed.code !== 0) return { ok: false, writers: [], status: this._failRun(listed) };
      const refs = parseForEachRef(listed.stdout);
      if (refs.length === 0 && this.hadRefs) {
        // hideRefs guard (panel evidence): an empty listing after a non-empty one is treated as "cannot see", never as "everyone left".
        return { ok: false, writers: [], status: this._fail('no-ref', 'remote listing empty after a non-empty one; keeping the previous snapshot') };
      }
      const writers = this._readWriters(this._pickNewest(refs));
      this.hadRefs = this.hadRefs || refs.length > 0;
      return { ok: true, writers, status: this._ok() };
    } catch (err) {
      return { ok: false, writers: [], status: this._fail('unknown', err && err.message) };
    }
  }

  /** One entry per (handle, device): the newer commit date wins across namespaces, custom wins a tie. */
  _pickNewest(refs) {
    const byKey = new Map();
    for (const r of refs) {
      const id = parseWriterRef(r.ref);
      if (!id) continue;
      const key = `${id.handle}/${id.device}`;
      const prev = byKey.get(key);
      const cand = { ...id, ...r };
      if (!prev || cand.committerDate > prev.committerDate || (cand.committerDate === prev.committerDate && cand.namespace === 'custom')) byKey.set(key, cand);
    }
    return [...byKey.values()].slice(0, MAX_WRITERS);
  }

  _readWriters(picked) {
    const out = [];
    const fresh = picked.filter((w) => !this.cache.has(w.sha));
    const sizes = fresh.length ? parseBatchCheck(this.runner.git(['cat-file', '--batch-check'], { input: fresh.map((w) => w.tree).join('\n') + '\n' }).stdout) : {};
    let budget = LIMITS.bytesPerSync;
    const next = new Map();
    for (const w of picked) {
      let files = this.cache.get(w.sha);
      if (!files) {
        const size = sizes[w.tree];
        if (!size || size.type !== 'tree' || size.size > TREE_BYTES) { logLine('transport', `skip ${w.ref}: top tree ${size ? size.size + ' bytes' : 'unreadable'}`); continue; }
        const read = this._readTree(w.tree, budget);
        budget = read.budget;
        files = read.files;
      }
      next.set(w.sha, files);
      out.push({ handle: w.handle, device: w.device, sha: w.sha, namespace: w.namespace, committerDate: w.committerDate, email: w.email, files });
    }
    this.cache = next;
    return out;
  }

  /** ls-tree the writer's tree, keep only allowed blobs, then one cat-file --batch for the survivors. */
  _readTree(tree, budget) {
    const ls = this.runner.git(['ls-tree', '-r', '-z', '-l', tree]);
    if (ls.code !== 0) return { files: {}, budget };
    const chosen = [];
    const seen = new Set();
    for (const e of parseLsTree(ls.stdout)) {
      if (chosen.length >= LIMITS.filesPerWriter) break;
      if (e.type !== 'blob' || !BLOB_MODES.has(e.mode) || e.size < 0 || e.size > LIMITS.blobBytes) continue;
      const p = allowedStatePath(e.path);
      if (!p || seen.has(p)) continue;
      if (e.size > budget) break;
      budget -= e.size;
      seen.add(p);
      chosen.push({ path: p, sha: e.sha });
    }
    const files = {};
    if (chosen.length) {
      const batch = this.runner.git(['cat-file', '--batch'], { input: chosen.map((c) => c.sha).join('\n') + '\n' });
      const blobs = batch.code === 0 ? parseCatFileBatch(batch.stdout) : {};
      for (const c of chosen) if (blobs[c.sha]) files[c.path] = blobs[c.sha];
    }
    return { files, budget };
  }
}
