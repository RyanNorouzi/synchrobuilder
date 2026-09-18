// Tiny line-based unified diff. Fixes touch a handful of lines, so we trim the common prefix and suffix first and only
// run the quadratic LCS on what is left; anything larger than the cap is shown as one replaced block rather than not at all.
const CONTEXT = 3;
const LCS_CAP = 4000;

function splitLines(text) {
  const lines = String(text).split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Edit script as [op, line] where op is ' ', '-' or '+'. */
export function diffLines(a, b) {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const ops = a.slice(0, start).map((l) => [' ', l]);
  if (midA.length * midB.length > LCS_CAP * LCS_CAP) {
    for (const l of midA) ops.push(['-', l]);
    for (const l of midB) ops.push(['+', l]);
  } else ops.push(...lcsOps(midA, midB));
  for (const l of a.slice(endA)) ops.push([' ', l]);
  return ops;
}

function lcsOps(a, b) {
  const n = a.length;
  const m = b.length;
  const table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push([' ', a[i]]); i++; j++; }
    else if (table[i + 1][j] >= table[i][j + 1]) ops.push(['-', a[i++]]);
    else ops.push(['+', b[j++]]);
  }
  while (i < n) ops.push(['-', a[i++]]);
  while (j < m) ops.push(['+', b[j++]]);
  return ops;
}

/** Group op indices into hunks: changes closer than 2 * CONTEXT lines share one hunk, as in `diff -u`. */
function hunkRanges(ops) {
  const ranges = [];
  for (let k = 0; k < ops.length; k++) {
    if (ops[k][0] === ' ') continue;
    const last = ranges[ranges.length - 1];
    if (last && k - last.end <= 2 * CONTEXT) last.end = k + 1;
    else ranges.push({ start: k, end: k + 1 });
  }
  return ranges.map((r) => ({ start: Math.max(0, r.start - CONTEXT), end: Math.min(ops.length, r.end + CONTEXT) }));
}

/** Unified diff text for one file, or '' when before and after are identical. Paths are shown a/<rel> and b/<rel>. */
export function unifiedDiff(rel, before, after) {
  if (before === after) return '';
  const ops = diffLines(splitLines(before.replace(/\r\n/g, '\n')), splitLines(after.replace(/\r\n/g, '\n')));
  // Old and new line numbers at each op index, so a hunk can be labelled from its first op.
  const oldAt = new Array(ops.length);
  const newAt = new Array(ops.length);
  let o = 1;
  let n = 1;
  for (let k = 0; k < ops.length; k++) {
    oldAt[k] = o;
    newAt[k] = n;
    if (ops[k][0] !== '+') o++;
    if (ops[k][0] !== '-') n++;
  }
  const out = [`--- a/${rel}`, `+++ b/${rel}`];
  for (const r of hunkRanges(ops)) {
    const slice = ops.slice(r.start, r.end);
    const oldCount = slice.filter(([op]) => op !== '+').length;
    const newCount = slice.filter(([op]) => op !== '-').length;
    out.push(`@@ -${oldAt[r.start]},${oldCount} +${newAt[r.start]},${newCount} @@`);
    for (const [op, line] of slice) out.push(`${op}${line}`);
  }
  return out.join('\n') + '\n';
}
