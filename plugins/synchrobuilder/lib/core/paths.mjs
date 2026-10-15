// Where Synchrobuilder keeps its state, and how a hook finds the right directory using file reads only (ADR-001 section 6).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export const CASE_INSENSITIVE = process.platform === 'win32' || process.platform === 'darwin';

export function homeDir() {
  const override = process.env.SYNCHROBUILDER_HOME;
  return override && override.trim() ? path.resolve(override) : path.join(os.homedir(), '.synchrobuilder');
}

export function toPosix(p) { return String(p).replace(/\\/g, '/'); }

/**
 * Resolve symlinks so one directory always hashes to one key. This matters on macOS, where the same temp directory is
 * both /var/folders/... and /private/var/folders/..., and anywhere a checkout sits under a symlinked or junctioned path:
 * a hook reporting one spelling and the CLI reporting the other must not end up with two separate state directories.
 */
export function realPath(p) {
  try { return fs.realpathSync.native(p); } catch { /* the path may not exist yet */ }
  try { return fs.realpathSync(p); } catch { return String(p); }
}

/** Canonical form of a filesystem path for hashing and comparing: absolute, forward slashes, lower-cased where the OS ignores case. */
export function canonicalPath(p) {
  let s = toPosix(path.resolve(p));
  if (CASE_INSENSITIVE) s = s.toLowerCase();
  return s.replace(/\/+$/, '');
}

export function shortHash(text, length = 16) {
  return crypto.createHash('sha256').update(String(text)).digest('hex').slice(0, length);
}

/** Walk up from `startDir` to the nearest `.git` entry (directory or worktree file). Returns null outside a repository. */
export function findGitEntry(startDir) {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 64; i++) {
    const candidate = path.join(dir, '.git');
    try {
      const st = fs.statSync(candidate);
      if (st.isDirectory() || st.isFile()) return { workTree: realPath(dir), gitEntry: realPath(candidate), isFile: st.isFile() };
    } catch { /* keep walking */ }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

/** Resolve the git directory and the common directory (linked worktrees point at a shared common dir) by reading files only. */
export function resolveGitDirs(startDir) {
  const entry = findGitEntry(startDir);
  if (!entry) return null;
  let gitDir = entry.gitEntry;
  if (entry.isFile) {
    const text = fs.readFileSync(entry.gitEntry, 'utf8');
    const m = text.match(/^gitdir:\s*(.+?)\s*$/m);
    if (!m) return null;
    gitDir = realPath(path.resolve(entry.workTree, m[1]));
  }
  let commonDir = gitDir;
  try {
    const rel = fs.readFileSync(path.join(gitDir, 'commondir'), 'utf8').trim();
    if (rel) commonDir = realPath(path.resolve(gitDir, rel));
  } catch { /* not a linked worktree */ }
  return { workTree: entry.workTree, gitDir, commonDir };
}

/** Minimal parser for git's INI-like config: returns { 'section "sub"': { key: value } }. Enough for remote URLs and user.email. */
export function parseGitConfig(text) {
  const out = {};
  let section = '';
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.replace(/^\s+/, '');
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const sec = line.match(/^\[([^\]]+)\]/);
    if (sec) {
      const parts = sec[1].match(/^(\S+)(?:\s+"(.*)")?$/);
      section = parts ? (parts[2] !== undefined ? `${parts[1].toLowerCase()} "${parts[2]}"` : parts[1].toLowerCase()) : sec[1].toLowerCase();
      out[section] = out[section] || {};
      continue;
    }
    const kv = line.match(/^([A-Za-z][A-Za-z0-9-]*)\s*=\s*(.*)$/);
    if (kv && section) out[section][kv[1].toLowerCase()] = kv[2].replace(/\s+[#;].*$/, '').trim().replace(/^"(.*)"$/, '$1');
  }
  return out;
}

export function readRemoteUrl(commonDir, remote = 'origin') {
  try {
    const cfg = parseGitConfig(fs.readFileSync(path.join(commonDir, 'config'), 'utf8'));
    const sec = cfg[`remote "${remote}"`];
    return sec && sec.url ? sec.url : null;
  } catch { return null; }
}

/** Normalize the spellings of one remote (ssh, scp-style, https, with or without .git) to a single key. */
export function normalizeRemoteUrl(url) {
  let s = String(url || '').trim();
  if (!s) return '';
  const scp = s.match(/^(?:[^@/]+@)?([^:/]+):(?!\/)(.+)$/);
  if (scp && !/^[a-z]+:\/\//i.test(s)) s = `ssh://${scp[1]}/${scp[2]}`;
  try {
    const u = new URL(s);
    let host = u.hostname.toLowerCase();
    let p = u.pathname.replace(/\/+/g, '/').replace(/\.git\/?$/, '').replace(/\/$/, '');
    if (/github\.com|gitlab\.com|bitbucket\.org/.test(host)) p = p.toLowerCase();
    return `${host}${p}`;
  } catch {
    return s.replace(/\.git$/, '');
  }
}

export function remoteKey(url) { return shortHash(normalizeRemoteUrl(url)); }

/** One workspace is one git working tree, which means one seat at the table.
 *
 *  This hashes the working tree's OWN git directory, not the common one. A plain clone keeps the key it
 *  always had, because there `gitDir` and `commonDir` are the same path. A linked worktree gets its own key
 *  instead of inheriting the main checkout's, which is what lets two agents in two worktrees hold separate
 *  journals, claims, throttles and guard caches rather than silently sharing one set (ADR-002 amendment).
 *
 *  The value doubles as the published `seat`: sixteen hex characters of a one-way hash of a local path, which
 *  is what isSeat() requires. It distinguishes workspaces without carrying anything about the machine off it. */
export function workspaceKey(gitDir) { return shortHash(canonicalPath(gitDir)); }

/** Kept for callers that still think in terms of the common directory. Prefer workspaceKey. */
export function checkoutKey(gitDir) { return workspaceKey(gitDir); }

export function checkoutDir(gitDir) { return path.join(homeDir(), 'checkouts', workspaceKey(gitDir)); }
export function remoteDir(url) { return path.join(homeDir(), 'remotes', remoteKey(url)); }

/** Everything a hook needs to know about where it is, found without spawning anything. Returns null outside a git repository. */
export function locate(startDir) {
  const dirs = resolveGitDirs(startDir);
  if (!dirs) return null;
  const remoteUrl = readRemoteUrl(dirs.commonDir);
  return {
    ...dirs,
    remoteUrl,
    // Keyed on this working tree's own git dir, so each worktree is its own seat.
    checkoutDir: checkoutDir(dirs.gitDir),
    seat: workspaceKey(dirs.gitDir),
    remoteDir: remoteUrl ? remoteDir(remoteUrl) : null,
    repoName: path.basename(dirs.workTree),
  };
}

/**
 * Repo-relative POSIX path for a file path a tool reported: absolute or relative, forward or back slashes, and possibly
 * spelled through a symlink (macOS /var vs /private/var, a junctioned drive on Windows). Null when it is outside the
 * work tree or inside .git.
 */
export function toRepoRelative(workTree, filePath, cwd = null) {
  if (!workTree || typeof filePath !== 'string' || !filePath.trim()) return null;
  const raw = filePath.trim();
  const isAbs = path.isAbsolute(raw) || /^[A-Za-z]:[\\/]/.test(raw) || raw.startsWith('/');
  const abs = path.resolve(isAbs ? raw : path.join(cwd || workTree, raw));
  const root = canonicalPath(workTree);
  for (const candidate of [canonicalPath(abs), canonicalPath(realPath(abs)), canonicalPath(path.join(realPath(path.dirname(abs)), path.basename(abs)))]) {
    if (candidate === root) return null;
    if (candidate.startsWith(root + '/')) {
      const rel = candidate.slice(root.length + 1);
      if (!rel || rel.split('/').some((seg) => seg === '.git')) return null;
      // canonicalPath lower-cases on case-insensitive systems; recover the original spelling when we can.
      const original = toPosix(abs).split('/').slice(toPosix(path.resolve(workTree)).split('/').length).join('/');
      return original && original.toLowerCase() === rel.toLowerCase() ? original : rel;
    }
  }
  return null;
}

export function isMuted(checkoutDirPath) {
  try { fs.accessSync(path.join(checkoutDirPath, 'mute')); return true; } catch { return false; }
}
