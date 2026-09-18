// PLACEHOLDER: the safety agent replaces this file with the full ADR-005 sanitizer. Until then this is a conservative minimum
// (escape, strip controls, cap length) so callers have a working interface.
//   sanitizeText(text, { maxChars = 400, maxLines = 6 }) -> string   (one or more lines, each already safe to prefix with '  | ')
//   sanitizeLine(text, maxChars) -> string                           (single line)
import { LIMITS } from '../core/schema.mjs';

const CONTROL = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g;
const FORMAT = /\p{Cf}/gu;

export function sanitizeLine(text, maxChars = LIMITS.task) {
  let s = String(text ?? '').normalize('NFC').replace(CONTROL, '').replace(FORMAT, '').replace(/\s+/g, ' ').trim();
  s = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const cps = Array.from(s);
  return cps.length > maxChars ? cps.slice(0, maxChars).join('') + ' ⋯' : s;
}

export function sanitizeText(text, { maxChars = LIMITS.message, maxLines = LIMITS.messageLines } = {}) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n').map((l) => sanitizeLine(l, LIMITS.lineChars)).filter(Boolean);
  const kept = lines.slice(0, maxLines);
  if (lines.length > maxLines) kept.push(`⋯ ${lines.length - maxLines} lines elided ⋯`);
  let out = kept.join('\n');
  const cps = Array.from(out);
  if (cps.length > maxChars) out = cps.slice(0, maxChars).join('') + ' ⋯';
  return out;
}
