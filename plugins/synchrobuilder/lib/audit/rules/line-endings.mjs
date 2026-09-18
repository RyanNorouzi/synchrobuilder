// Line endings: a missing or weak .gitattributes lets every checkout pick its own endings, and CRLF inside
// shell scripts, Dockerfiles, Makefiles and shebang scripts breaks them outright ("bad interpreter: ^M").
import { lineOf } from '../engine.mjs';

export const RECOMMENDED_GITATTRIBUTES = ['* text=auto eol=lf', '*.sh text eol=lf', '*.cmd text eol=crlf', '*.bat text eol=crlf', '*.ps1 text eol=crlf'].join('\n') + '\n';
const MAX_FILE_FINDINGS = 50;
// A "* text=auto" style rule: a line whose pattern is "*" and whose attributes include text or text=auto (not -text or !text).
const TEXT_AUTO_RULE = /^\*[ \t]+(?:[^\s#]+[ \t]+)*text(?:=auto)?(?:[ \t]|$)/m;

/** Files that must keep LF endings no matter which OS checked them out. Returns a description or null. */
export function mustBeLf(rel, firstLine) {
  const base = rel.includes('/') ? rel.slice(rel.lastIndexOf('/') + 1) : rel;
  if (/\.(sh|bash)$/i.test(base)) return 'a shell script';
  if (/^Dockerfile(\..*)?$/i.test(base) || /\.dockerfile$/i.test(base)) return 'a Dockerfile';
  if (/^(GNUmakefile|makefile|Makefile)$/.test(base) || /\.mk$/i.test(base)) return 'a Makefile';
  if (base === '.gitattributes') return 'the .gitattributes file';
  if (/\.(mjs|cjs|js)$/i.test(base) && firstLine && firstLine.startsWith('#!')) return 'a script with a shebang line';
  return null;
}

function gitattributesFinding(index) {
  const rel = '.gitattributes';
  const fix = `Create .gitattributes with this content, then run "git add --renormalize ." once:\n${RECOMMENDED_GITATTRIBUTES}`;
  if (!index.has(rel)) {
    return { file: rel, message: 'No .gitattributes: every checkout uses its own core.autocrlf setting, so teammates on Windows and macOS commit different line endings for the same files.', fix, data: { recommended: RECOMMENDED_GITATTRIBUTES, missing: true } };
  }
  const content = index.read(rel);
  if (content === null) return null;
  if (TEXT_AUTO_RULE.test(content)) return null;
  return { file: rel, line: 1, message: '.gitattributes has no "* text=auto" rule, so git does not normalize line endings and each machine commits whatever its editor wrote.', fix: `Add a "* text=auto" rule. Recommended content:\n${RECOMMENDED_GITATTRIBUTES}`, data: { recommended: RECOMMENDED_GITATTRIBUTES, missing: false } };
}

function crlfFinding(index, rel) {
  // Cheap pre-filter on the name; only shebang detection needs the content.
  const base = rel.includes('/') ? rel.slice(rel.lastIndexOf('/') + 1) : rel;
  const nameOnly = mustBeLf(rel, '');
  const maybeScript = /\.(mjs|cjs|js)$/i.test(base);
  if (!nameOnly && !maybeScript) return null;
  const content = index.read(rel);
  if (content === null) return null;
  const nl = content.indexOf('\n');
  const firstLine = content.slice(0, nl === -1 ? content.length : nl);
  const kind = mustBeLf(rel, firstLine);
  if (!kind) return null;
  const at = content.indexOf('\r\n');
  if (at === -1) return null;
  let count = 0;
  for (let i = at; i !== -1 && count < 100000; i = content.indexOf('\r\n', i + 2)) count++;
  return {
    file: rel, line: lineOf(content, at),
    message: `CRLF line endings in ${kind} (${count} line${count === 1 ? '' : 's'}); the interpreter reads the carriage return as part of the command and fails.`,
    fix: 'Convert the file to LF and keep it that way with a .gitattributes rule ("*.sh text eol=lf", "Dockerfile* text eol=lf", "Makefile text eol=lf"), then run "git add --renormalize .".',
    data: { crlfLines: count },
  };
}

export default {
  id: 'line-endings',
  severity: 'medium',
  title: 'Line-ending rules missing or CRLF in files that must be LF',
  explain: 'Without a .gitattributes rule git leaves line endings to each machine, and CRLF endings inside shell scripts, Dockerfiles, Makefiles and shebang scripts make them fail on macOS, Linux and in containers.',
  scope: 'project',
  check({ index }) {
    const findings = [];
    const ga = gitattributesFinding(index);
    if (ga) findings.push(ga);
    let perFile = 0;
    for (const rel of index.files) {
      if (perFile >= MAX_FILE_FINDINGS) break;
      const f = crlfFinding(index, rel);
      if (f) { findings.push(f); perFile++; }
    }
    return findings;
  },
};
