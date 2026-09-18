// Assembly and budgeting of pre-sanitized entries into one injection (ADR-005 step 15).
//   assembleWithinBudget(entries, { maxChars, kind, generatedAt }) -> { text: string | null, kept, dropped }
// Entries: { meta, lines, priority?, receivedAt? }. Lower priority number = more important; missing priority falls
// back on PRIORITY[meta.kind]. Within one priority newer entries (receivedAt, ms or ISO string) come first.
// Runs inside hooks, so it only measures and concatenates: no regex over teammate text happens here.
import { LIMITS } from '../core/schema.mjs';
import { wrapTeammateData, renderEntry, renderPreamble, renderMetaLine, beginMarker, endMarker, MAX_BLOCK_CHARS } from './wrap.mjs';

export const PRIORITY = Object.freeze({ claim: 0, message: 1, alert: 2, handoff: 3, presence: 4, board: 5 });
const LOWEST = 9;
const MEASURE_NONCE = '0'.repeat(16);

function priorityOf(entry) {
  if (Number.isFinite(entry.priority)) return entry.priority;
  const kind = entry.meta && typeof entry.meta.kind === 'string' ? entry.meta.kind : '';
  return Object.prototype.hasOwnProperty.call(PRIORITY, kind) ? PRIORITY[kind] : LOWEST;
}

function receivedMs(entry) {
  const v = entry.receivedAt;
  const t = typeof v === 'number' ? v : typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : 0;
}

export function assembleWithinBudget(entries, { maxChars = LIMITS.digestChars, kind = 'digest', generatedAt } = {}) {
  const budget = Math.min(maxChars, MAX_BLOCK_CHARS - 1);
  const list = (Array.isArray(entries) ? entries : []).filter((e) => e && typeof e === 'object');
  const ordered = list.map((e, i) => ({ e, p: priorityOf(e), t: receivedMs(e), i, size: renderEntry(e).join('\n').length + 1 }))
    .sort((a, b) => a.p - b.p || b.t - a.t || a.i - b.i);
  const when = typeof generatedAt === 'string' ? generatedAt : new Date().toISOString();
  // Fixed cost of the frame plus a worst-case '@truncated' line, measured with the same renderers the wrapper uses.
  const frame = renderPreamble(kind, when).length + 1 + beginMarker(MEASURE_NONCE, kind).length + 1 + endMarker(MEASURE_NONCE).length;
  const trailer = renderMetaLine('truncated', { entries: list.length, reason: `${kind}-cap` }).length + 1;
  let total = frame + trailer;
  let kept = 0;
  for (const item of ordered) {
    if (total + item.size > budget) break;
    total += item.size;
    kept++;
  }
  const dropped = ordered.length - kept;
  const truncated = dropped ? { entries: dropped, reason: `${kind}-cap` } : undefined;
  const text = wrapTeammateData({ kind, entries: ordered.slice(0, kept).map((x) => x.e), generatedAt: when, truncated });
  return { text: text && text.length <= budget ? text : null, kept: text ? kept : 0, dropped };
}
