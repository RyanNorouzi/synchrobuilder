// Python assumptions: "python" is Python 2 or missing on many Linux/macOS machines and "python3" does not exist
// on Windows; virtualenv activation lives in bin/ on POSIX and Scripts\ on Windows. Each line that hard-codes one
// side gets a finding with the portable spelling.
const MAX_FINDINGS = 40;
const PY_MARKERS = /(^|\/)(requirements[^/]*\.txt|pyproject\.toml|setup\.py|setup\.cfg|Pipfile|poetry\.lock|tox\.ini|environment\.ya?ml)$/i;
const DOC = /\.(md|markdown|rst|txt)$/i;
// Words that usually precede a "python" that is prose ("written in python"), not a command.
const PROSE_BEFORE = /^(a|an|the|in|of|for|with|to|and|or|is|are|your|our|any|this|that|using|use|via|from|about|on|by|as|into|no|not|new|old|plain|pure|modern|only|also|like)$/i;
const COMMAND_BEFORE = /^(run|RUN|sudo|exec|env|time|nohup|then|do|elif|else|if|cmd|sh|bash|xargs|-c|\$|&&|\|\||\||;|\(|`)$/;
const CALL = /(^|[^A-Za-z0-9_./\\-])(python|pip)(?=\s+\S|\s*$)/g;
const OLD_SHEBANG = /^#!\s*(\/usr\/bin\/python|\/usr\/local\/bin\/python|\/usr\/bin\/env\s+python)\s*$/;
const POSIX_ACTIVATE = /(?:^|[\s"'`=:])((?:[\w.-]+\/)*(?:venv|\.venv|env|\.env|virtualenv)\/bin\/activate(?:\.fish|\.csh)?)/;
const WIN_ACTIVATE = /((?:[\w.-]+[\\/])*(?:venv|\.venv|env|\.env|virtualenv)[\\/]Scripts[\\/]activate(?:\.bat|\.ps1)?)/i;

/** Only lines in fenced or indented code blocks count in documentation; prose mentions of python are fine. */
function codeLines(lines, isDoc) {
  if (!isDoc) return lines.map((text, i) => ({ text, i }));
  const out = [];
  let fenced = false;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i];
    if (/^\s*(```|~~~)/.test(t)) { fenced = !fenced; continue; }
    if (fenced || /^( {4}|\t)/.test(t) || /^\s*\$ /.test(t)) out.push({ text: t, i });
  }
  return out;
}

function previousToken(text, index) {
  const before = text.slice(0, index).trimEnd();
  const m = before.match(/(\S+)$/);
  return m ? m[1] : '';
}

/** "python foo.py" / "pip install" in command position; returns the command word or null. Comment lines never count. */
export function findInterpreterCall(text) {
  if (/^\s*(#|\/\/|<!--)/.test(text)) return null;
  CALL.lastIndex = 0;
  let m;
  while ((m = CALL.exec(text))) {
    const prev = previousToken(text, m.index + m[1].length);
    if (!prev || COMMAND_BEFORE.test(prev)) return m[2];
    // A plain English word before it ("written in python", "the pip cache") is prose; anything else is a command.
    if (/^[A-Za-z]+$/.test(prev) && PROSE_BEFORE.test(prev)) continue;
    return m[2];
  }
  return null;
}

const ACTIVATE_FIX = 'create the environment with "python3 -m venv .venv" and document both activations: "source .venv/bin/activate" (macOS/Linux) and ".venv\\Scripts\\activate" (Windows)';

function lineFinding(rel, i, text, { hasPython, bothActivations }) {
  const problems = [];
  const fixes = [];
  if (i === 0 && OLD_SHEBANG.test(text)) {
    problems.push('shebang points at "python", which is Python 2 on old systems and absent on new ones');
    fixes.push('use "#!/usr/bin/env python3"');
  } else if (hasPython) {
    const cmd = findInterpreterCall(text);
    if (cmd === 'python') { problems.push('calls "python" instead of "python3"'); fixes.push('use "python3" (and "py -3" in Windows-specific steps)'); }
    if (cmd === 'pip') { problems.push('calls "pip" directly'); fixes.push('use "python3 -m pip" ("py -3 -m pip" on Windows) so pip matches the interpreter'); }
  }
  if (!bothActivations) {
    const posix = text.match(POSIX_ACTIVATE);
    const win = text.match(WIN_ACTIVATE);
    if (posix && !win) { problems.push(`hard-codes the POSIX activation path "${posix[1]}"`); fixes.push(ACTIVATE_FIX); }
    if (win && !posix) { problems.push(`hard-codes the Windows activation path "${win[1]}"`); fixes.push(ACTIVATE_FIX); }
  }
  if (!problems.length) return null;
  return { file: rel, line: i + 1, message: `Line ${problems.join(' and ')}.`, fix: fixes.join('; ') + '.', data: { problems } };
}

export default {
  id: 'python-assumptions',
  severity: 'medium',
  title: 'python instead of python3, bare pip, or one-OS virtualenv paths',
  explain: '"python" means Python 2 or nothing on many macOS and Linux machines while "python3" does not exist on Windows, and virtualenv activation lives under bin/ on POSIX but Scripts\\ on Windows. Spell out the interpreter and document both activations.',
  scope: 'file',
  appliesTo: (rel) => /\.(sh|bash|zsh|py|md|markdown|rst|txt|yml|yaml|toml|cfg|ini|json|ps1|cmd|bat|mjs|cjs|js|ts)$/i.test(rel) || /(^|\/)(Makefile|GNUmakefile|makefile|Dockerfile[^/]*|Procfile|Justfile|justfile)$/.test(rel),
  check({ relPath, content, index }) {
    const isPy = /\.py$/i.test(relPath);
    const hasPython = isPy || index.files.some((f) => /\.py$/i.test(f) || PY_MARKERS.test(f));
    // A file that documents both activation paths already did the right thing; do not flag each line of it.
    const bothActivations = POSIX_ACTIVATE.test(content) && WIN_ACTIVATE.test(content);
    const findings = [];
    const lines = content.split('\n');
    for (const { text, i } of codeLines(lines, DOC.test(relPath))) {
      if (findings.length >= MAX_FINDINGS) break;
      const f = lineFinding(relPath, i, text.replace(/\r$/, ''), { hasPython, bothActivations });
      if (f) findings.push(f);
    }
    return findings;
  },
};
