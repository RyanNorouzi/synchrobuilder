// Fixer: rewrite an import or require specifier to the spelling that exists on disk, so it also resolves on a
// case-sensitive file system. Expects finding.data.expected (the real spelling) and, when the rule provides it,
// finding.data.specifier (the spelling in the source); otherwise the quoted string on the finding's line that matches
// `expected` case-insensitively is taken as the specifier.
const QUOTED = /(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g;

function stripDots(spec) { return spec.replace(/^(?:\.\.?\/)+/, ''); }
function prefixDots(spec) { const m = spec.match(/^(?:\.\.?\/)+/); return m ? m[0] : ''; }

/** New spelling for `spec` given the real path `expected`; null when the two do not describe the same file. */
export function respell(spec, expected) {
  if (spec.toLowerCase() === expected.toLowerCase()) return expected;
  // `expected` may be repo-relative while the specifier is relative to the importing file: match the trailing segments.
  const tail = stripDots(spec);
  const segs = tail.split('/').length;
  const expSegs = expected.split('/');
  if (expSegs.length < segs) return null;
  const expTail = expSegs.slice(expSegs.length - segs).join('/');
  if (expTail.toLowerCase() !== tail.toLowerCase()) return null;
  return prefixDots(spec) + expTail;
}

function rewriteLine(line, specifier, expected) {
  let changed = null;
  const out = line.replace(QUOTED, (m, q, s) => {
    if (changed !== null) return m;
    if (specifier && s !== specifier) return m;
    const next = respell(s, expected);
    if (!next || next === s) return m;
    changed = next;
    return `${q}${next}${q}`;
  });
  return changed === null ? null : out;
}

export default {
  id: 'import-casing',
  rules: ['import-casing'],
  fix({ content, finding }) {
    const data = finding.data || {};
    const expected = typeof data.expected === 'string' ? data.expected.replace(/\\/g, '/') : '';
    const specifier = typeof data.specifier === 'string' ? data.specifier : (typeof data.actual === 'string' ? data.actual : '');
    if (!expected) return { content, notes: [`${finding.file}: the rule did not say what the real spelling is (finding.data.expected); left unchanged.`] };
    const lines = content.split('\n');
    const targets = finding.line && finding.line >= 1 && finding.line <= lines.length ? [finding.line - 1] : lines.map((_, i) => i);
    for (const i of targets) {
      const next = rewriteLine(lines[i], specifier, expected);
      if (next !== null) { lines[i] = next; return { content: lines.join('\n'), notes: [] }; }
    }
    return { content, notes: [`${finding.file}${finding.line ? `:${finding.line}` : ''}: could not find a specifier matching ${expected}; left unchanged.`] };
  },
};
