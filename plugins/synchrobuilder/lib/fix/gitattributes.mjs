// Fixer: create or extend .gitattributes so line endings are normalized the same way on every checkout.
// Existing patterns are kept as they are; only patterns the file does not mention yet are appended.
// finding.data.rules (array of attribute lines) overrides the default set when a rule supplies one.
export const DEFAULT_RULES = [
  '* text=auto eol=lf',
  '*.bat text eol=crlf',
  '*.cmd text eol=crlf',
  '*.ps1 text eol=crlf',
  '*.png binary',
  '*.jpg binary',
  '*.jpeg binary',
  '*.gif binary',
  '*.ico binary',
  '*.pdf binary',
  '*.zip binary',
  '*.woff binary',
  '*.woff2 binary',
];

const HEADER = '# Line endings and binaries, added by synchrobuilder fix';

function pattern(line) { return line.trim().split(/\s+/)[0]; }

export default {
  id: 'gitattributes',
  rules: ['gitattributes', 'line-endings'],
  targetFile: (finding) => (/(^|\/)\.gitattributes$/.test(finding.file || '') ? finding.file : '.gitattributes'),
  fix({ content, finding }) {
    const wanted = Array.isArray(finding.data && finding.data.rules) && finding.data.rules.every((r) => typeof r === 'string') && finding.data.rules.length
      ? finding.data.rules.map((r) => r.trim()).filter(Boolean)
      : DEFAULT_RULES;
    const existing = content === null ? '' : content.replace(/\r\n/g, '\n');
    const seen = new Set(existing.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#')).map(pattern));
    const missing = wanted.filter((r) => !seen.has(pattern(r)));
    if (missing.length === 0) return { content: existing, notes: [`${finding.file}: .gitattributes already covers every recommended pattern; left unchanged.`] };
    const base = existing.length && !existing.endsWith('\n') ? `${existing}\n` : existing;
    const block = (base.length ? '\n' : '') + [HEADER, ...missing].join('\n') + '\n';
    return { content: base + block, notes: [] };
  },
};
