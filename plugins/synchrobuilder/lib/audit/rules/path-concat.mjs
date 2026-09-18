// Paths built by gluing strings together. "dir + '/' + name" happens to work on Windows, but the same habit
// produces "dir + '\\' + name" that breaks everywhere else, and neither normalizes separators, trailing slashes
// or drive letters. path.join does all of that.
import { lineOf } from '../engine.mjs';

const CONCAT = /(?:^|[=(,:[]|\breturn\b)\s*([A-Za-z_$][\w$.]*|\)|['"][^'"\n]*['"])\s*\+\s*(['"])([\\/])\2\s*\+/g;
const TRAILING = /(['"])([^'"\n]*[\\/])\1\s*\+\s*[A-Za-z_$][\w$.]*/g;
// ident + '/name' or ident + '\\name': the separator rides on the string literal.
const LEADING = /[A-Za-z_$][\w$.\])]*\s*\+\s*(['"])[\\/][^'"\n]*\1/g;

export default {
  id: 'path-concat',
  severity: 'medium',
  title: 'File path built by string concatenation',
  explain: 'A path glued together with "+" and a separator character assumes one operating system\'s separator and skips normalization. path.join picks the right separator, collapses duplicate slashes and handles a trailing separator on the left-hand side.',
  scope: 'file',
  appliesTo: (rel) => /\.(mjs|cjs|js|jsx|ts|tsx|mts|cts)$/i.test(rel) && !/(^|\/)(node_modules|dist|build)\//.test(rel),
  check({ relPath, content }) {
    const findings = [];
    const seen = new Set();
    for (const re of [CONCAT, TRAILING, LEADING]) {
      re.lastIndex = 0;
      let m;
      let guard = 0;
      while ((m = re.exec(content)) && guard++ < 50) {
        const line = lineOf(content, m.index);
        if (seen.has(line)) continue;
        // A URL or an import specifier is not a filesystem path.
        const text = content.split('\n')[line - 1] || '';
        if (/https?:|\bnew URL\(|\bimport\s|\brequire\(/.test(text)) continue;
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
