// Presence: who else is active, how fresh their state is, and whether they are relevant to what this checkout is editing.
import { presenceAgeMs, tierOf, isSelf, claimActive, pathsOverlap, coversPath } from './common.mjs';

/**
 * Teammates with a live presence, newest first. Excludes this identity (same handle and device) and anyone not seen in 24 h.
 * Each row: { writer, handle, device, branch, task, area, ageMs, tier, verified }.
 */
export function activeWriters(snapshot, now, identity) {
  if (!snapshot || !Array.isArray(snapshot.writers)) return [];
  const rows = [];
  for (const w of snapshot.writers) {
    if (isSelf(w, identity)) continue;
    const ageMs = presenceAgeMs(w, now);
    const tier = tierOf(ageMs);
    if (tier === 'gone') continue;
    const p = w.presence || {};
    rows.push({ writer: w, handle: w.handle, device: w.device, branch: p.branch || null, task: p.task || '', area: p.area || null, ageMs, tier, verified: w.verified });
  }
  return rows.sort((a, b) => a.ageMs - b.ageMs);
}

/** Distinct handles seen in the last `windowMs` (default 30 days), including this identity. Used by the seats notice. */
export function handlesActiveWithin(snapshot, now, windowMs = 30 * 24 * 3600 * 1000) {
  const handles = new Set();
  for (const w of snapshot && snapshot.writers ? snapshot.writers : []) {
    const age = presenceAgeMs(w, now);
    if (Number.isFinite(age) && age <= windowMs) handles.add(w.handle);
  }
  return handles;
}

/** Rows whose declared area or active claims overlap any of this checkout's recently edited paths. */
export function relevantWriters(rows, recentPaths, now) {
  const paths = [...recentPaths];
  if (!paths.length) return [];
  return rows.filter((r) => {
    if (r.area && paths.some((p) => coversPath(r.area, p))) return true;
    return (r.writer.claims || []).some((c) => c.path && claimActive(c, r.writer, now) && paths.some((p) => pathsOverlap(c.path, p)));
  });
}
