// Heuristics that turn the last assistant message into handoff fields. The message is read locally and only the extracted
// lines survive (ADR-005 open question: no prose from the transcript is stored, just labelled lines and bullets).
import { LIMITS, isHandle } from '../core/schema.mjs';
import { redact } from '../safety/redact.mjs';

const LABEL = /^(decision|decided|blocked|blocker|next)\s*:\s*(.+)$/i;
const HEADING = /^(?:#{1,6}\s*|\*\*)?([^*#]+?)(?:\*\*)?:?\s*$/;
const BULLET = /^(?:[-*+•]|\d+[.)])\s+(.+)$/;
const MENTION = /@([a-z0-9][a-z0-9-]{0,31})(?![a-z0-9-])/g;

/** One clean line for a handoff field: no controls, no secrets, no markdown emphasis, at most LIMITS.task code points. */
export function cleanLine(text) {
  let s = redact(String(text ?? '')).text.normalize('NFC').replace(/[\x00-\x1f\x7f-\x9f]/g, ' ').replace(/\p{Cf}/gu, '').replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ').trim();
  const cps = Array.from(s);
  return cps.length > LIMITS.task ? cps.slice(0, LIMITS.task - 1).join('') + '~' : s;
}

function strip(line) { return line.replace(/^[\s>]*(?:[-*+•]|\d+[.)])?\s*/, '').replace(/\*\*/g, '').trim(); }

function bucketFor(heading) {
  const h = heading.toLowerCase();
  if (h.includes('next step')) return 'next';
  if (h.includes('blocker')) return 'blockers';
  if (h.includes('decision')) return 'decisions';
  return null;
}

/** { decisions, blockers, next, for } from labelled lines and from bullets under matching headings. */
export function extractFromMessage(text) {
  const out = { decisions: [], blockers: [], next: [], for: [] };
  if (typeof text !== 'string' || !text.trim()) return out;
  const push = (k, v) => { const c = cleanLine(v); if (c && !out[k].includes(c)) out[k].push(c); };
  let bucket = null;
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n').slice(0, 400)) {
    const line = raw.trim();
    if (!line) { continue; }
    const labelled = strip(line).match(LABEL);
    if (labelled) {
      const key = labelled[1].toLowerCase();
      push(key.startsWith('dec') ? 'decisions' : key.startsWith('block') ? 'blockers' : 'next', labelled[2]);
      continue;
    }
    const bullet = line.match(BULLET);
    if (bullet) { if (bucket) push(bucket, bullet[1]); continue; }
    const heading = line.match(HEADING);
    if (heading && line.length < 60) { bucket = bucketFor(heading[1]); continue; }
    bucket = null; // a paragraph ends the list under a heading
  }
  for (const m of text.matchAll(MENTION)) if (isHandle(m[1]) && !out.for.includes(m[1])) out.for.push(m[1]);
  for (const k of ['decisions', 'next']) out[k] = out[k].slice(0, 10);
  out.blockers = out.blockers.slice(0, 5);
  out.for = out.for.slice(0, 8);
  return out;
}

/** "Edited N files under dir/ (a.ts, b.ts)" lines, largest directory first. */
export function describeEdits(paths) {
  const groups = new Map();
  for (const p of paths) {
    const i = p.lastIndexOf('/');
    const dir = i === -1 ? '.' : p.slice(0, i);
    if (!groups.has(dir)) groups.set(dir, []);
    groups.get(dir).push(i === -1 ? p : p.slice(i + 1));
  }
  return [...groups.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 5)
    .map(([dir, names]) => `Edited ${names.length} file${names.length === 1 ? '' : 's'} under ${dir}/ (${names.slice(0, 4).join(', ')}${names.length > 4 ? ', ...' : ''})`);
}
