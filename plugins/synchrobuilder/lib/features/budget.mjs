// Renders prioritized sections of teammate entries into one wrapped block that fits a character budget (ADR-005 section 2 step 15).
// Sections come in priority order; when the block is too long the last entry of the lowest-priority non-empty section is dropped
// first, repeatedly, and an "@entry kind=truncated" line records how many entries were left out.
import { wrapTeammateData } from '../safety/wrap.mjs';

/** Length of the entry body alone (the lines between the markers), used where the budget excludes the fixed preamble. */
export function bodyLength(entries) {
  let n = 0;
  for (const e of entries) {
    n += 10 + Object.entries(e.meta || {}).reduce((a, [k, v]) => a + k.length + String(v).length + 2, 0);
    for (const line of e.lines || []) n += 5 + line.length;
  }
  return n;
}

function flatten(sections) { return sections.flatMap((s) => s.entries); }

/**
 * sections: [{ entries: [{ meta, lines }] }] highest priority first.
 * measure: 'total' budgets the whole additionalContext string, 'body' only the entry lines.
 * Returns { text, kept, dropped } or null when nothing fits.
 */
export function renderBudgeted({ kind, sections, limit, measure = 'total', generatedAt }) {
  const live = sections.map((s) => ({ entries: [...s.entries] }));
  let dropped = 0;
  const render = () => {
    const entries = flatten(live);
    if (dropped) entries.push({ meta: { kind: 'truncated', dropped }, lines: [] });
    return { entries, text: wrapTeammateData({ kind, entries, generatedAt }) };
  };
  const size = (r) => (r.text === null ? Infinity : measure === 'body' ? bodyLength(r.entries) : r.text.length);
  let result = render();
  while (size(result) > limit) {
    let victim = null;
    for (let i = live.length - 1; i >= 0; i--) if (live[i].entries.length) { victim = live[i]; break; }
    if (!victim) return null;
    victim.entries.pop();
    dropped++;
    result = render();
  }
  const entries = flatten(live);
  // `entries` are the survivors (extra properties such as a caller's `key` are preserved) so callers can mark them delivered.
  return entries.length && result.text !== null ? { text: result.text, kept: entries.length, dropped, entries } : null;
}
