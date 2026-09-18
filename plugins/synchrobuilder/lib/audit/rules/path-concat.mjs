// Paths built by gluing strings together. "dir + '/' + name" happens to work on Windows, but the same habit
// produces "dir + '\\' + name" that breaks everywhere else, and neither normalizes separators, duplicate slashes
// or a trailing separator on the left. path.join does all of that.
//
// The rule is deliberately narrow. A separator has to be a real one: a forward slash, or a backslash written as the
// two-character escape. A newline or tab escape is not a separator, and neither is a slash inside a URL, a regular
// expression, an import specifier or a string comparison.
import { lineOf } from '../engine.mjs';

// <expr> + '/' + : a separator standing alone between two operands.
const BETWEEN = /(?:^|[=(,:[]|\breturn\b)\s*(?:[A-Za-z_$][\w$.]*|\)|['"][^'"\n]*['"])\s*\+\s*(['"])(?:\/|\\\\)\1\s*\+/g;
// <expr> + '/name' : the separator rides on the front of a string literal that looks like a path segment.
const LEADING = /[A-Za-z_$][\w$.\])]*\s*\+\s*(['"])(?:\/|\\\\)[A-Za-z0-9_.@$-][^'"\n]*\1/g;
// 'dir/' + <expr> : the separator rides on the end of a string literal.
const TRAILING = /(['"])[^'"\n]*[A-Za-z0-9_.@$-](?:\/|\\\\)\1\s*\+\s*[A-Za-z_$][\w$.]*/g;

// Lines where a slash means something other than a path.
const NOT_A_PATH = /https?:|\bnew URL\(|\bimport\s|\brequire\(|\bstartsWith\(|\bendsWith\(|\bincludes\(|\bsplit\(|\bjoin\(|\breplace\(|\bmatch\(|\btest\(|\bRegExp\b|\/\/|=~|\bprocess\.stdout\b|\bconsole\./;

export default {
  id: 'path-concat',
  severity: 'medium',
  title: 'File path built by string concatenation',
  explain: 'A path glued together with "+" and a separator assumes one operating system\'s separator and skips normalization. path.join picks the right separator, collapses duplicate slashes and handles a trailing separator on the left-hand side.',
  scope: 'file',
  appliesTo: (rel) => /\.(mjs|cjs|js|jsx|ts|tsx|mts|cts)$/i.test(rel) && !/(^|\/)(node_modules|dist|build)\//.test(rel),
  check({ relPath, content }) {
    const lines = content.split('\n');
    const findings = [];
    const seen = new Set();
    for (const re of [BETWEEN, LEADING, TRAILING]) {
      re.lastIndex = 0;
      let m;
      let guard = 0;
      while ((m = re.exec(content)) && guard++ < 50) {
        const line = lineOf(content, m.index);
        if (seen.has(line)) continue;
        const text = lines[line - 1] || '';
        if (NOT_A_PATH.test(text)) continue;
        seen.add(line);
        findings.push({
          file: relPath,
          line,
          message: `Builds a path with string concatenation: ${text.trim().slice(0, 100)}`,
          fix: 'Use path.join(...) (import path from "node:path") so the separator and normalization are correct on every operating system.',
          data: { snippet: text.trim().slice(0, 200) },
        });
      }
    }
    return findings;
  },
};
