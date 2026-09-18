// The ADR-005 free-text sanitizer, applied on the reader side at sync time to every teammate string that is not an
// identifier (identifiers are validated or rejected in lib/core/schema.mjs and never cleaned).
//   sanitizeText(text, { maxChars = 400, maxLines = 6 }) -> string   (lines joined with LF, each safe to prefix with '  | ')
//   sanitizeLine(text, maxChars = 140) -> string                      (single line)
//   sanitizeLines(text, opts) -> string[]                             (same as sanitizeText, split)
//   sanitizeWithStats(text, opts) -> { text, lines, stats }            (for the sync loop's local counters, ADR-005 step 17)
// Order matters and follows ADR-005 section 2 exactly: pre-cap, NFC, escapes, controls, format chars, whitespace,
// line shaping, markup, URLs, secrets, code-point cap, HTML escape. Everything is a linear scan over a pre-capped string.
import { LIMITS } from '../core/schema.mjs';
import { normalizeUnicode, stripEscapes, stripControls, stripInvisible, splitLines } from './strip.mjs';
import { neutralizeLine, defangUrls, escapeHtml } from './markup.mjs';
import { redact } from './redact.mjs';
import { capCodePoints, preTruncate } from './caps.mjs';

export const ELIDED_MARK = ' ⋯';

function emptyStats() {
  return { rejected: false, escapes: 0, controls: 0, invisible: 0, fences: 0, headings: 0, rules: 0, roleLabels: 0, markers: 0, urls: 0, urlsRemoved: 0, redactions: 0, linesElided: 0, linesCapped: 0, truncated: false };
}

function capLine(line, lineChars, stats) {
  const r = capCodePoints(line, lineChars);
  if (!r.truncated) return line;
  stats.linesCapped++;
  return r.text + ELIDED_MARK;
}

/** Full pipeline with counters. Non-strings are rejected (empty result, stats.rejected = true). */
export function sanitizeWithStats(text, { maxChars = LIMITS.message, maxLines = LIMITS.messageLines, lineChars = LIMITS.lineChars } = {}) {
  const stats = emptyStats();
  if (typeof text !== 'string') { stats.rejected = true; return { text: '', lines: [], stats }; }
  // Steps 2 to 6: bound the work, then remove everything a terminal or a tokenizer would interpret.
  let s = normalizeUnicode(preTruncate(text, Math.max(64, maxChars * 4)));
  const esc = stripEscapes(s); stats.escapes = esc.removed;
  const ctl = stripControls(esc.text); stats.controls = ctl.removed;
  const inv = stripInvisible(ctl.text); stats.invisible = inv.removed;
  // Step 7 and 8: whitespace, then line shaping. Single-line fields fold LF into a space before any line rule runs.
  let lines = splitLines(inv.text);
  if (maxLines <= 1 && lines.length > 1) lines = [lines.join(' ')];
  let elided = 0;
  if (lines.length > maxLines) { elided = lines.length - maxLines; lines = lines.slice(0, maxLines); }
  stats.linesElided = elided;
  // Steps 9 and 10 per line, step 11 over the whole field so a PEM block that spans lines is still one match.
  const urlState = { count: 0 };
  const out = [];
  for (const raw of lines) {
    const shaped = neutralizeLine(capLine(raw, lineChars, stats), stats);
    if (shaped === null) continue;
    out.push(defangUrls(shaped, urlState, stats));
  }
  if (elided) out.push(`⋯ ${elided} lines elided ⋯`);
  const red = redact(out.join('\n'));
  stats.redactions = red.count;
  // Steps 12 and 13. A cut that lands just after a LF would leave the marker alone on a line starting with a space,
  // so trailing whitespace goes before the marker is appended.
  const capped = capCodePoints(red.text, maxChars);
  stats.truncated = capped.truncated;
  const escaped = escapeHtml(capped.truncated ? capped.text.trimEnd() + ELIDED_MARK : capped.text);
  return { text: escaped, lines: escaped ? escaped.split('\n') : [], stats };
}

export function sanitizeText(text, opts) { return sanitizeWithStats(text, opts).text; }

export function sanitizeLines(text, opts) { return sanitizeWithStats(text, opts).lines; }

/** Single-line fields (task summary, board title, handoff items): LF becomes a space, one cap in code points. */
export function sanitizeLine(text, maxChars = LIMITS.task) {
  return sanitizeWithStats(text, { maxChars, maxLines: 1, lineChars: Infinity }).text;
}
