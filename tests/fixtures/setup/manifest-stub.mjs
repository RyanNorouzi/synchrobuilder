// Test-only stand-in for lib/manifest/io.mjs and lib/manifest/schema.mjs (written in parallel by another agent).
// Tests import the real modules first and fall back to this file; the lead can delete it once both land.
//   readManifest(root) -> manifest|null
//   validateManifest(obj) -> { ok, errors, manifest }
//   tokenizeCommand(str) -> string[]   (throws on shell syntax, per ADR-004)
import fs from 'node:fs';
import path from 'node:path';

export function readManifest(root) {
  try { return JSON.parse(fs.readFileSync(path.join(root, 'synchrobuilder.json'), 'utf8')); } catch { return null; }
}

export function validateManifest(obj) {
  const errors = [];
  if (!obj || typeof obj !== 'object') errors.push('manifest is not an object');
  else if (obj.version !== 1) errors.push('version must be 1');
  return { ok: errors.length === 0, errors, manifest: errors.length ? null : obj };
}

const SHELL = /[|&;<>$`]/;
export function tokenizeCommand(str) {
  const out = [];
  let cur = '';
  let quote = null;
  let has = false;
  const s = String(str ?? '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === '\\' && i + 1 < s.length && quote === '"') cur += s[++i];
      else cur += c;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; has = true; continue; }
    if (c === '\\' && i + 1 < s.length) { cur += s[++i]; has = true; continue; }
    if (/\s/.test(c)) { if (has) { out.push(cur); cur = ''; has = false; } continue; }
    if (SHELL.test(c)) throw new Error(`shell syntax "${c}" is not allowed in manifest commands (audit rule: shell-syntax)`);
    cur += c; has = true;
  }
  if (quote) throw new Error('unterminated quote in manifest command');
  if (has) out.push(cur);
  return out;
}
