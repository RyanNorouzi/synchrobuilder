// Code-point caps for teammate text (ADR-005 step 12). Caps are counted in code points, never in UTF-16 units,
// and a cut never lands inside a surrogate pair or between the two halves of a regional-indicator (flag) pair.

const RI_FIRST = 0x1f1e6;
const RI_LAST = 0x1f1ff;

function isRegionalIndicator(cp) { return cp >= RI_FIRST && cp <= RI_LAST; }

/** Number of code points in a string (Array.from would allocate; this only counts). */
export function codePointLength(text) {
  let n = 0;
  for (const _ of text) n++;
  return n;
}

/** Truncate `text` to at most `max` code points. Returns { text, truncated }. The caller appends its own marker. */
export function capCodePoints(text, max) {
  if (!Number.isFinite(max) || max < 0) return { text, truncated: false };
  const cps = Array.from(text);
  if (cps.length <= max) return { text, truncated: false };
  let cut = max;
  // Flags are two regional indicators in a row; a cut after an odd number of consecutive indicators would split one.
  if (cut > 0 && isRegionalIndicator(cps[cut].codePointAt(0)) && isRegionalIndicator(cps[cut - 1].codePointAt(0))) {
    let run = 0;
    for (let i = cut - 1; i >= 0 && isRegionalIndicator(cps[i].codePointAt(0)); i--) run++;
    if (run % 2 === 1) cut--;
  }
  return { text: cps.slice(0, cut).join(''), truncated: true };
}

/** UTF-16 pre-truncation before any regex runs (ADR-005 step 2). Drops a trailing high surrogate so no pair is split. */
export function preTruncate(text, maxUnits) {
  if (text.length <= maxUnits) return text;
  let s = text.slice(0, maxUnits);
  const last = s.charCodeAt(s.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) s = s.slice(0, -1);
  return s;
}
