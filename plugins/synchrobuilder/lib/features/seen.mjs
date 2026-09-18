// Tracks which teammate messages and handoffs this checkout has already shown to Claude, so nothing is delivered twice.
// <checkoutDir>/seen.json: { messages: { key: isoSeenAt }, handoffs: { key: isoSeenAt }, lastDigestAt }
import path from 'node:path';
import { readJson, writeJsonAtomic } from '../core/fsx.mjs';
import { shortHash } from '../core/paths.mjs';
import { logLine } from '../core/log.mjs';

const KEEP_MS = 14 * 24 * 3600 * 1000;

export function seenFile(checkoutDir) { return path.join(checkoutDir, 'seen.json'); }

export function readSeen(checkoutDir) {
  const raw = checkoutDir ? readJson(seenFile(checkoutDir), null) : null;
  const table = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? { ...v } : {});
  return { messages: table(raw && raw.messages), handoffs: table(raw && raw.handoffs), lastDigestAt: raw && typeof raw.lastDigestAt === 'string' ? raw.lastDigestAt : null };
}

/** Prunes entries older than two weeks so the file never grows without bound. Never throws. */
export function writeSeen(checkoutDir, seen, now = Date.now()) {
  if (!checkoutDir) return false;
  const prune = (t) => Object.fromEntries(Object.entries(t).filter(([, at]) => { const ms = Date.parse(at); return !Number.isFinite(ms) || now - ms < KEEP_MS; }));
  try {
    writeJsonAtomic(seenFile(checkoutDir), { messages: prune(seen.messages), handoffs: prune(seen.handoffs), lastDigestAt: seen.lastDigestAt });
    return true;
  } catch (err) {
    logLine('features', `seen.json write failed: ${err && err.message}`);
    return false;
  }
}

/** A message without a valid ulid is keyed by its content so a re-sync of the same file counts as seen. */
export function messageKey(m) { return m.id || shortHash(`${m.from}|${m.at}|${m.text}`); }
export function handoffKey(h) { return h.id || shortHash(`${h.from}|${h.at}|${h.task}|${(h.done || []).join(';')}`); }
