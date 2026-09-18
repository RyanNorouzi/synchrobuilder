// Guard baseline cache: the finding signatures a file had before Claude edited it, so the guard can report only what is new.
// Lives at <checkoutDir>/own/guard-cache.json: { version: 1, files: { '<repo-relative path>': { at: iso, keys: [signature] } } }.
// Signatures are rule + message, deliberately line-insensitive, so an edit that only shifts lines is not "new".
import path from 'node:path';
import { readJson, writeJsonAtomic } from '../core/fsx.mjs';
import { CASE_INSENSITIVE } from '../core/paths.mjs';

export const CACHE_VERSION = 1;
export const MAX_CACHED_FILES = 500;

export function cacheFile(checkoutDir) { return path.join(checkoutDir, 'own', 'guard-cache.json'); }

/** Cache key for a repo-relative POSIX path; folded where the file system ignores case. */
export function cacheKey(relPath) { return CASE_INSENSITIVE ? relPath.toLowerCase() : relPath; }

/** Stable signature of a finding: rule id plus message, never the line number. */
export function signature(finding) {
  return `${finding.rule || '?'}|${String(finding.message || '').trim()}`;
}

export function readCache(checkoutDir) {
  const raw = readJson(cacheFile(checkoutDir), null);
  if (!raw || raw.version !== CACHE_VERSION || !raw.files || typeof raw.files !== 'object') return { version: CACHE_VERSION, files: {} };
  return raw;
}

/** Baseline signatures for a file, or null when the cache has no entry (which is different from an empty list). */
export function readBaseline(checkoutDir, relPath) {
  const entry = readCache(checkoutDir).files[cacheKey(relPath)];
  return entry && Array.isArray(entry.keys) ? entry.keys.filter((k) => typeof k === 'string') : null;
}

/** Store the signatures for one file, evicting the oldest entries past the cap. Atomic write; throws only on I/O failure. */
export function writeBaseline(checkoutDir, relPath, keys) {
  const cache = readCache(checkoutDir);
  cache.files[cacheKey(relPath)] = { at: new Date().toISOString(), keys };
  const entries = Object.entries(cache.files);
  if (entries.length > MAX_CACHED_FILES) {
    entries.sort((a, b) => String(a[1].at || '').localeCompare(String(b[1].at || '')));
    cache.files = Object.fromEntries(entries.slice(entries.length - MAX_CACHED_FILES));
  }
  writeJsonAtomic(cacheFile(checkoutDir), cache);
}

/** Findings whose signature occurs more often now than in the baseline (a multiset difference, so a second identical mistake still counts). */
export function newFindings(findings, baselineKeys) {
  const budget = new Map();
  for (const k of baselineKeys || []) budget.set(k, (budget.get(k) || 0) + 1);
  const fresh = [];
  for (const f of findings) {
    const k = signature(f);
    const left = budget.get(k) || 0;
    if (left > 0) budget.set(k, left - 1); else fresh.push(f);
  }
  return fresh;
}
