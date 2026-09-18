// Heuristic extraction of the exported names a contract file declares. It runs on this machine's own file right after an
// edit, so it only needs to be fast and roughly right: names feed a journal event and a note, never a decision.
import path from 'node:path';
import { isSymbol } from '../core/schema.mjs';

const MAX = 20;
const JS_DECL = /^\s*export\s+(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:function\*?|const|let|var|class|type|interface|enum|namespace)\s+([A-Za-z_$][\w$]*)/;
const JS_LIST = /export\s*\{([^}]*)\}/g;
const PRISMA = /^\s*(?:model|type|enum|view)\s+([A-Za-z_]\w*)/;
const GRAPHQL = /^\s*(?:extend\s+)?(?:type|interface|enum|input|union|scalar)\s+([A-Za-z_]\w*)/;
const PROTO = /^\s*(?:message|enum|service)\s+([A-Za-z_]\w*)/;
const YAML_KEY = /^([A-Za-z_$][\w$.-]*)\s*:/;

function lines(text) { return String(text).replace(/\r\n?/g, '\n').split('\n'); }

function perLine(text, re) {
  const out = [];
  for (const line of lines(text)) { const m = line.match(re); if (m) out.push(m[1]); }
  return out;
}

function fromJs(text) {
  const out = perLine(text, JS_DECL);
  for (const m of String(text).matchAll(JS_LIST)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop();
      if (name && name !== 'default') out.push(name.replace(/^type\s+/, ''));
    }
  }
  return out;
}

function fromJson(text) {
  let doc;
  try { doc = JSON.parse(text); } catch { return []; }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return [];
  const out = Object.keys(doc);
  for (const k of ['properties', 'definitions', '$defs']) if (doc[k] && typeof doc[k] === 'object') out.push(...Object.keys(doc[k]));
  if (doc.components && doc.components.schemas && typeof doc.components.schemas === 'object') out.push(...Object.keys(doc.components.schemas));
  return out;
}

function fromYaml(text) {
  const out = [];
  let inProps = false;
  for (const line of lines(text)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const top = line.match(YAML_KEY);
    if (top) { out.push(top[1]); inProps = top[1] === 'properties' || top[1] === 'definitions'; continue; }
    const nested = line.match(/^  ([A-Za-z_$][\w$.-]*)\s*:/);
    if (nested && inProps) out.push(nested[1]);
  }
  return out;
}

/** Distinct valid symbol names (at most 20) for a repo-relative path and its content; [] for unknown formats. */
export function extractSymbols(relPath, text) {
  const ext = path.posix.extname(relPath).toLowerCase();
  const base = path.posix.basename(relPath).toLowerCase();
  let names = [];
  if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'].includes(ext)) names = fromJs(text);
  else if (ext === '.prisma') names = perLine(text, PRISMA);
  else if (ext === '.graphql' || ext === '.gql') names = perLine(text, GRAPHQL);
  else if (ext === '.proto') names = perLine(text, PROTO);
  else if (ext === '.json' || base.endsWith('.json')) names = fromJson(text);
  else if (ext === '.yaml' || ext === '.yml') names = fromYaml(text);
  return [...new Set(names.filter(isSymbol))].slice(0, MAX);
}
