// Replace hand-built path strings with path.join. Deliberately conservative: only the shape
// <expr> + '/' + <expr> (or a backslash separator), only in JavaScript and TypeScript, and only when the
// result is unambiguous. Anything else is reported as unfixable rather than rewritten badly.
const SEP = /^(['"`])([\\/])\1$/;

/** Split a line into top-level '+' operands, ignoring '+' inside quotes, parentheses, brackets or template holes. */
function splitPlus(text) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === '+' && depth === 0) { parts.push(text.slice(start, i)); start = i + 1; }
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.trim());
}

/**
 * Turn the operands of a "+" chain into path.join arguments:
 *   ["dir", "'/'", "name"]   -> ["dir", "name"]        a bare separator between two operands
 *   ["dir", "'/name.json'"]  -> ["dir", "'name.json'"] the separator riding on a string literal
 * Returns null when the expression is not an unambiguous path.
 */
export function joinOperands(parts) {
  if (parts.length === 2) {
    const [left, right] = parts;
    const lit = right.match(/^(['"])([\\/])([^'"]*)\1$/);
    if (!lit || /^['"`]/.test(left) || !left) return null;
    if (lit[3].includes('/') || lit[3].includes('\\')) {
      const segments = lit[3].split(/[\\/]/).filter(Boolean).map((seg) => `${lit[1]}${seg}${lit[1]}`);
      return segments.length ? [left, ...segments] : null;
    }
    return lit[3] ? [left, `${lit[1]}${lit[3]}${lit[1]}`] : null;
  }
  if (parts.length < 3) return null;
  const out = [];
  let sawSeparator = false;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p) return null;
    if (SEP.test(p)) {
      if (i === 0 || i === parts.length - 1) return null; // a leading or trailing separator changes the meaning
      sawSeparator = true;
      continue;
    }
    // A string operand that carries its own separator (e.g. "src/" or "/index.js") is ambiguous; leave it alone.
    if (/^(['"])(.*)\1$/.test(p) && /[\\/]/.test(p.slice(1, -1))) return null;
    if (p.startsWith('`')) return null;
    out.push(p);
  }
  return sawSeparator && out.length >= 2 ? out : null;
}

/** Split a trailing // comment off a line, ignoring one inside a string. Returns [code, comment]. */
export function splitComment(line) {
  let quote = null;
  for (let i = 0; i < line.length - 1; i++) {
    const c = line[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '/' && (line[i + 1] === '/' || line[i + 1] === '*')) return [line.slice(0, i), line.slice(i)];
  }
  return [line, ''];
}

export function rewriteLine(line) {
  const [code, comment] = splitComment(line);
  // Find a candidate expression: a run between an assignment or return boundary and the end of the statement.
  const m = code.match(/^(\s*(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*|\s*[A-Za-z_$][\w$.]*\s*=\s*|\s*return\s+)(.+?)(;?\s*)$/);
  if (!m) return null;
  const operands = joinOperands(splitPlus(m[2]));
  if (!operands) return null;
  return `${m[1]}path.join(${operands.join(', ')})${m[3]}${comment}`;
}

/** Add `import path from 'node:path';` (or require) when the file does not already bring one in. */
export function ensurePathImport(content) {
  if (/\bfrom\s+['"]node:path['"]|\brequire\(\s*['"](?:node:)?path['"]\s*\)|\bfrom\s+['"]path['"]/.test(content)) return content;
  const lines = content.split('\n');
  const isEsm = /^\s*(?:import|export)\s/m.test(content);
  const statement = isEsm ? "import path from 'node:path';" : "const path = require('node:path');";
  let insertAt = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(#!|\/\/|\/\*|\s*$)/.test(lines[i])) { insertAt = i + 1; continue; }
    if (/^\s*(import|const .* = require\()/.test(lines[i])) { insertAt = i + 1; continue; }
    break;
  }
  lines.splice(insertAt, 0, statement);
  return lines.join('\n');
}

export default {
  id: 'path-concat',
  rules: ['hardcoded-paths', 'path-concat'],
  fix({ content, finding }) {
    if (!/\.(mjs|cjs|js|jsx|ts|tsx|mts|cts)$/i.test(finding.file || '')) {
      return { content, notes: [`${finding.file}: path.join only applies to JavaScript and TypeScript; left unchanged.`] };
    }
    const lines = content.split('\n');
    const targets = finding.line && finding.line >= 1 && finding.line <= lines.length ? [finding.line - 1] : lines.map((_, i) => i);
    for (const i of targets) {
      const next = rewriteLine(lines[i]);
      if (next !== null && next !== lines[i]) {
        lines[i] = next;
        return { content: ensurePathImport(lines.join('\n')), notes: [] };
      }
    }
    return { content, notes: [`${finding.file}${finding.line ? `:${finding.line}` : ''}: not a simple "a + '/' + b" expression; fix it by hand.`] };
  },
};
