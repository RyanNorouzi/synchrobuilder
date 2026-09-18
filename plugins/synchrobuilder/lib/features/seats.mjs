// Seats notice: a friendly, non-blocking note shown by `status` at most once per config.seats.noticeEveryDays when more than
// three handles were active in the last 30 days. Isolated on purpose: nothing but the status command imports this file, and
// nothing here disables or limits any feature (docs/commands.md: "Nothing is ever disabled").
import { readJson, writeJsonAtomic } from '../core/fsx.mjs';

export const PRICING_URL = 'https://github.com/OWNER/REPO'; // placeholder until the project has a public home (PLAN.md question 6)
export const FREE_SEATS = 3;
const DAY_MS = 24 * 3600 * 1000;

function ageMs(writer, now) {
  const times = [writer.firstSeenAt, writer.presence && writer.presence.lastSeen].map((t) => Date.parse(t || '')).filter(Number.isFinite);
  return times.length ? Math.max(...times.map((t) => now - t)) : NaN;
}

/** Distinct handles whose state was seen within 30 days (this identity included). */
export function activeHandles(snapshot, now) {
  const handles = new Set();
  for (const w of snapshot && Array.isArray(snapshot.writers) ? snapshot.writers : []) {
    if (typeof w.handle !== 'string') continue;
    const age = ageMs(w, now);
    if (Number.isFinite(age) && age <= 30 * DAY_MS) handles.add(w.handle);
  }
  return handles;
}

/**
 * Returns the note and records the time in `stateFile` ({ lastNoticeAt, activeHandles }), or null when fewer than four
 * handles were active or a notice was shown within `noticeEveryDays`. Never throws.
 */
export function seatsNotice(snapshot, now = Date.now(), stateFile, { noticeEveryDays = 7 } = {}) {
  const handles = activeHandles(snapshot, now);
  if (handles.size <= FREE_SEATS) return null;
  const state = (stateFile && readJson(stateFile, null)) || {};
  const last = Date.parse(state.lastNoticeAt || '');
  if (Number.isFinite(last) && now - last < noticeEveryDays * DAY_MS) return null;
  if (stateFile) { try { writeJsonAtomic(stateFile, { lastNoticeAt: new Date(now).toISOString(), activeHandles: handles.size }); } catch { /* the note still shows; it may repeat sooner */ } }
  return `Note: ${handles.size} people were active on this repository in the last 30 days. Synchrobuilder stays free and nothing is limited or disabled; if your team finds it useful, a hosted hub for teams is planned. Pricing page: ${PRICING_URL} (placeholder link). This note appears at most once every ${noticeEveryDays} days.`;
}
