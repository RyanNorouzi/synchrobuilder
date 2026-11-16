// Is the remote world-readable? Everything the worker publishes (handle, branch, claims, handoffs, messages) lands
// in refs that anyone who can read the repository can fetch, so on a public repository it is published to the world.
// The worker asks this before publishing and holds back unless the team set transport.allowPublic.
//
// Only GitHub can be answered without credentials: an anonymous GET of the repository returns 200 for a public
// repository and 404 for a private or missing one. Every other host, and every failure, is 'unknown', which does
// not block: refusing to sync on a network blip would break the feature for every private repository.
import path from 'node:path';
import { readJson, writeJsonAtomic } from '../core/fsx.mjs';
import { logLine } from '../core/log.mjs';

const KNOWN_TTL_MS = 24 * 60 * 60 * 1000;
const UNKNOWN_TTL_MS = 60 * 60 * 1000;
const TIMEOUT_MS = 5000;

/** { owner, repo } for a github.com remote in https, ssh or scp form, else null. */
export function parseGitHubRemote(url) {
  const s = String(url || '').trim();
  const m = s.match(/^(?:https?:\/\/(?:[^@/]+@)?github\.com\/|ssh:\/\/git@github\.com(?::\d+)?\/|git@github\.com:)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/i);
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}

async function askGitHub({ owner, repo }, fetchImpl) {
  try {
    const res = await fetchImpl(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'synchrobuilder' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 404) return 'private';
    if (res.status !== 200) return 'unknown';
    const body = await res.json();
    return body && body.private === false ? 'public' : 'private';
  } catch (err) {
    logLine('worker', `visibility check failed: ${err && err.message}`);
    return 'unknown';
  }
}

/** 'public' | 'private' | 'unknown', cached per remote in <remoteDir>/visibility.json. Never throws. */
export async function remoteVisibility(remoteUrl, { remoteDir = null, now = Date.now(), fetchImpl = globalThis.fetch } = {}) {
  const gh = parseGitHubRemote(remoteUrl);
  if (!gh || typeof fetchImpl !== 'function') return 'unknown';
  const file = remoteDir ? path.join(remoteDir, 'visibility.json') : null;
  const cached = file ? readJson(file, null) : null;
  if (cached && cached.url === remoteUrl && Number.isFinite(cached.checkedAt)) {
    const ttl = cached.visibility === 'unknown' ? UNKNOWN_TTL_MS : KNOWN_TTL_MS;
    if (now - cached.checkedAt < ttl && ['public', 'private', 'unknown'].includes(cached.visibility)) return cached.visibility;
  }
  const visibility = await askGitHub(gh, fetchImpl);
  if (file) { try { writeJsonAtomic(file, { url: remoteUrl, visibility, checkedAt: now }); } catch { /* cache is a convenience */ } }
  return visibility;
}
