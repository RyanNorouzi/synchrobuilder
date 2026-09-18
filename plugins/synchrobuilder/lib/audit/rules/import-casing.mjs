// Relative import specifiers whose capitalization does not match the file on disk.
// macOS and Windows resolve them anyway; Linux (and every CI runner) fails with "module not found".
import path from 'node:path';
import { lineOf } from '../engine.mjs';

const posix = path.posix;
const EXTS = ['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.json', '.css', '.scss', '.vue', '.svelte'];
// TypeScript projects import './x.js' and resolve it to x.ts; try those spellings too so a casing bug there is not missed.
const TS_MAP = { '.js': ['.ts', '.tsx'], '.jsx': ['.tsx'], '.mjs': ['.mts'], '.cjs': ['.cts'] };
const MAX_FINDINGS = 50;

// Each pattern captures the specifier in group 1. None of them nests a quantifier: they scan a line at most once.
const JS_PATTERNS = [
  /\bfrom\s*["'`]([^"'`\n]+)["'`]/g,                       // import x from '...', export { y } from '...'
  /\bimport\s*["'`]([^"'`\n]+)["'`]/g,                     // import '...'
  /\b(?:require|import)\s*\(\s*["'`]([^"'`\n]+)["'`]\s*\)/g, // require('...'), import('...')
];
const CSS_PATTERNS = [
  /@import\s+(?:url\(\s*)?["']?([^"'()\s;]+)["']?/g,          // @import './x.css', @import url(x.css)
  /\burl\(\s*["']?([^"'()\s]+)["']?\s*\)/g,                  // url(./img/logo.png)
];
const JS_EXT = /\.(mjs|cjs|js|jsx|ts|tsx|mts|cts|vue|svelte|astro)$/i;
const CSS_EXT = /\.(css|scss|vue|svelte|astro|html)$/i;

/** True when the line holding `offset` is a line comment or a block-comment continuation; cheap enough for every match. */
function inComment(content, offset) {
  let start = offset;
  while (start > 0 && content.charCodeAt(start - 1) !== 10) start--;
  const lead = content.slice(start, offset).trimStart();
  return lead.startsWith('//') || lead.startsWith('*') || lead.startsWith('/*') || lead.startsWith('<!--');
}

/** Normalizes a raw specifier to a posix relative path, or returns null when it is not a relative file reference. */
function relativeSpec(raw) {
  let s = raw.trim().replace(/\\\\/g, '/').replace(/\\/g, '/');
  const q = s.search(/[?#]/);
  if (q >= 0) s = s.slice(0, q);
  if (!s.startsWith('./') && !s.startsWith('../')) return null;
  return s.replace(/\/+$/, '');
}

/** Every path the specifier may resolve to, in resolver order, with what was stripped from and added to the original spelling. */
function candidates(resolved) {
  const out = [{ rel: resolved, stripped: 0, added: '' }];
  for (const e of EXTS) out.push({ rel: resolved + e, stripped: 0, added: e });
  const ext = posix.extname(resolved).toLowerCase();
  for (const alt of TS_MAP[ext] || []) out.push({ rel: resolved.slice(0, -ext.length) + alt, stripped: ext.length, added: alt });
  for (const e of EXTS) out.push({ rel: `${resolved}/index${e}`, stripped: 0, added: '', index: true });
  return out;
}

/** The specifier as it should be written so that it matches `hit` (the real spelling on disk). */
function expectedSpec(dir, spec, hit, cand) {
  let real = hit;
  if (cand.index) real = real.slice(0, real.lastIndexOf('/'));
  else real = real.slice(0, real.length - cand.added.length) + (cand.stripped ? spec.slice(spec.length - cand.stripped) : '');
  let expected = posix.relative(dir, real);
  if (!expected.startsWith('../')) expected = `./${expected}`;
  return expected;
}

function checkSpec({ relPath, content, index, dir, spec, offset, findings, seen }) {
  if (seen.has(spec)) return;
  const resolved = posix.normalize(posix.join(dir, spec));
  if (resolved.startsWith('../') || resolved === '..') return; // outside the project: nothing to compare against
  const list = candidates(resolved);
  if (list.some((c) => index.has(c.rel))) return; // an exact spelling exists; the resolver will find it everywhere
  const cand = list.find((c) => index.hasCaseInsensitive(c.rel));
  if (!cand) return; // missing file, not a casing problem
  const hit = (index.lower.get(cand.rel.toLowerCase()) || [])[0];
  if (!hit) return;
  const expected = expectedSpec(dir, spec, hit, cand);
  if (expected === spec) return;
  seen.add(spec);
  findings.push({
    file: relPath,
    line: lineOf(content, offset),
    message: `Import '${spec}' only resolves on case-insensitive disks; the file is spelled ${hit}`,
    fix: `Change the specifier to '${expected}'`,
    data: { actual: spec, expected, resolved: hit },
  });
}

function scan(patterns, ctx) {
  for (const re of patterns) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(ctx.content)) && ctx.findings.length < MAX_FINDINGS) {
      if (inComment(ctx.content, m.index)) continue;
      const spec = relativeSpec(m[1]);
      if (spec) checkSpec({ ...ctx, spec, offset: m.index });
    }
  }
}

export default {
  id: 'import-casing',
  severity: 'high',
  title: 'Import path casing does not match the file on disk',
  explain: 'macOS and Windows ignore case when resolving imports, Linux does not. An import that works locally then fails on CI or a teammate\'s machine with "module not found". Spell the specifier exactly as the file is named.',
  scope: 'file',
  appliesTo: (rel) => JS_EXT.test(rel) || CSS_EXT.test(rel),
  check({ relPath, content, index }) {
    const findings = [];
    if (!index || !content) return findings;
    const dir = relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : '';
    const ctx = { relPath, content, index, dir, findings, seen: new Set() };
    if (JS_EXT.test(relPath)) scan(JS_PATTERNS, ctx);
    if (CSS_EXT.test(relPath)) scan(CSS_PATTERNS, ctx);
    return findings;
  },
};
