// Git runner for the hidden bare repository (ADR-001 section 4): argv-only spawning through lib/core/proc.mjs, --git-dir always
// explicit, scrubbed environment, per-call timeouts, classified errors. Also the pure parsers for the git output the transport reads,
// kept here so git-refs.mjs only orchestrates. Nothing in this file throws on a git failure; callers read { code, errorClass }.
import fs from 'node:fs';
import path from 'node:path';
import { run, scrubbedEnv } from '../core/proc.mjs';
import { classifyGitError } from './interface.mjs';

export const TIMEOUTS = Object.freeze({ fetch: 20000, push: 30000, other: 10000 });

// ls-remote talks to the network like fetch does, so it gets the fetch budget rather than the local-command budget.
const NETWORK_SUBCOMMANDS = new Set(['fetch', 'ls-remote']);

// Config the hidden repo needs. fsck stays off on purpose: one poisoned ref would otherwise fail the whole multi-ref fetch
// (panel evidence), and we never check anything out, so path validation is the reader's job (git-refs.mjs).
export const HIDDEN_REPO_CONFIG = Object.freeze([
  ['gc.auto', '0'],
  ['commit.gpgsign', 'false'],
  ['transfer.fsckObjects', 'false'],
  ['fetch.fsckObjects', 'false'],
  ['receive.fsckObjects', 'false'],
  ['protocol.version', '2'],
  ['core.autocrlf', 'false'],
]);

/** Which timeout a git argv gets: the first argument that is not a --option names the subcommand. */
export function timeoutFor(args) {
  const sub = (args || []).find((a) => typeof a === 'string' && !a.startsWith('-')) || '';
  if (sub === 'push') return TIMEOUTS.push;
  if (NETWORK_SUBCOMMANDS.has(sub)) return TIMEOUTS.fetch;
  return TIMEOUTS.other;
}

/** Error class for a finished run: the shared classifier first, then the runner-level cases it cannot see (timeouts, spawn errors). */
export function classifyRun(result) {
  if (!result || result.code === 0) return null;
  if (result.timedOut) return 'network';
  const text = `${result.stderr || ''}\n${result.stdout || ''}`;
  const shared = classifyGitError(text);
  if (shared !== 'unknown') return shared;
  // A remote path or host that git cannot open at all reads like a network failure to the caller (nothing was reached).
  if (/Could not read from remote repository|does not appear to be a git repository|repository .* not found|Connection closed|kex_exchange_identification/i.test(text)) return 'network';
  if (result.error && /ENOENT|EACCES|spawn/i.test(result.error)) return 'unknown';
  return 'unknown';
}

/** A runner bound to one hidden repository. git(args, { input, timeoutMs, env }) never throws. */
export function createRunner({ repoDir }) {
  const gitDir = path.resolve(repoDir);
  function git(args, opts = {}) {
    const argv = ['--git-dir', gitDir, ...args];
    const r = run('git', argv, {
      cwd: gitDir,
      timeoutMs: opts.timeoutMs || timeoutFor(args),
      env: scrubbedEnv(opts.env || {}),
      input: opts.input,
      maxBuffer: opts.maxBuffer,
    });
    return { code: r.code, stdout: r.stdout, stderr: r.stderr, timedOut: !!r.timedOut, error: r.error || null, errorClass: classifyRun(r) };
  }
  return { gitDir, git };
}

/** Create (or repair the config of) the hidden bare repository. Records nothing about remotes or credentials. */
export function initHidden(repoDir) {
  const gitDir = path.resolve(repoDir);
  const templateDir = path.join(gitDir, 'sb-template');
  const hooksDir = path.join(gitDir, 'sb-nohooks');
  try {
    fs.mkdirSync(templateDir, { recursive: true });
    fs.mkdirSync(hooksDir, { recursive: true });
  } catch (err) {
    return { ok: false, created: false, detail: `mkdir failed: ${err && err.message}` };
  }
  const runner = createRunner({ repoDir: gitDir });
  let created = false;
  if (!fs.existsSync(path.join(gitDir, 'HEAD'))) {
    const init = runner.git(['init', '--bare', '--quiet', `--template=${templateDir}`, gitDir]);
    if (init.code !== 0) return { ok: false, created: false, detail: firstLine(init.stderr) || init.error || 'git init failed' };
    created = true;
  }
  const settings = [['core.hooksPath', hooksDir], ...HIDDEN_REPO_CONFIG];
  for (const [key, value] of settings) {
    const r = runner.git(['config', key, value]);
    if (r.code !== 0) return { ok: false, created, detail: `git config ${key} failed: ${firstLine(r.stderr) || r.error || ''}` };
  }
  return { ok: true, created, detail: created ? 'created' : 'existing' };
}

export function firstLine(text) {
  return String(text || '').split(/\r?\n/).map((l) => l.trim()).find(Boolean) || '';
}

/** `ls-remote <url> <pattern>` output -> { ref: sha }. Tolerates CRLF. */
export function parseLsRemote(stdout) {
  const out = {};
  for (const line of String(stdout || '').split(/\r?\n/)) {
    const m = line.match(/^([0-9a-f]{40,64})\s+(\S+)$/);
    if (m) out[m[2]] = m[1];
  }
  return out;
}

/** for-each-ref with FOR_EACH_REF_FORMAT -> [{ sha, tree, committerDate, email, ref }]. */
export const FOR_EACH_REF_FORMAT = '%(objectname)%00%(tree)%00%(committerdate:unix)%00%(authoremail)%00%(refname)';
export function parseForEachRef(stdout) {
  const out = [];
  for (const line of String(stdout || '').split(/\r?\n/)) {
    if (!line) continue;
    const [sha, tree, date, email, ref] = line.split('\0');
    if (!/^[0-9a-f]{40,64}$/.test(sha || '') || !/^[0-9a-f]{40,64}$/.test(tree || '') || !ref) continue;
    out.push({ sha, tree, committerDate: Number.parseInt(date, 10) || 0, email: String(email || '').replace(/^<|>$/g, '').toLowerCase(), ref });
  }
  return out;
}

/** `ls-tree -r -z -l <tree>` output -> [{ mode, type, sha, size, path }]. Sizes are '-' for subtrees (never listed with -r). */
export function parseLsTree(stdout) {
  const out = [];
  for (const entry of String(stdout || '').split('\0')) {
    if (!entry) continue;
    const m = entry.match(/^(\d{6}) (\w+) ([0-9a-f]{40,64}) +(\d+|-)\t([\s\S]*)$/);
    if (!m) continue;
    out.push({ mode: m[1], type: m[2], sha: m[3], size: m[4] === '-' ? -1 : Number.parseInt(m[4], 10), path: m[5] });
  }
  return out;
}

/** `cat-file --batch-check` output -> { sha: { type, size } } ('missing' objects get type 'missing'). */
export function parseBatchCheck(stdout) {
  const out = {};
  for (const line of String(stdout || '').split(/\r?\n/)) {
    const m = line.match(/^([0-9a-f]{40,64}) (\w+)(?: (\d+))?$/);
    if (m) out[m[1]] = { type: m[2], size: m[3] === undefined ? -1 : Number.parseInt(m[3], 10) };
  }
  return out;
}

/**
 * `cat-file --batch` output -> { sha: Buffer }. proc.run decodes as UTF-8, so the text is re-encoded and walked by byte offsets;
 * a blob that was not valid UTF-8 shifts the offsets, which the header check detects, and parsing stops there (the remaining
 * blobs are simply absent). Every file the transport accepts must be JSON, so a non-UTF-8 blob would have been dropped anyway.
 */
export function parseCatFileBatch(stdout) {
  const buf = Buffer.from(String(stdout || ''), 'utf8');
  const out = {};
  let pos = 0;
  while (pos < buf.length) {
    const nl = buf.indexOf(0x0a, pos);
    if (nl < 0) break;
    const header = buf.subarray(pos, nl).toString('utf8');
    const m = header.match(/^([0-9a-f]{40,64}) (\w+)(?: (\d+))?$/);
    if (!m) break;
    pos = nl + 1;
    if (m[2] === 'missing' || m[3] === undefined) continue;
    const size = Number.parseInt(m[3], 10);
    if (pos + size > buf.length) break;
    out[m[1]] = Buffer.from(buf.subarray(pos, pos + size));
    pos += size;
    if (buf[pos] !== 0x0a) break;
    pos += 1;
  }
  return out;
}
