// Loads the manifest reader (lib/manifest/io.mjs + schema.mjs, written in parallel by the manifest agent).
// Until those files land the tiny fallback below keeps `setup` usable; it mirrors the ADR-004 tokenizer rules
// (quotes and backslash escapes only, shell syntax rejected). The lead can delete the fallback after the merge.
import fs from 'node:fs';
import path from 'node:path';

const SHELL_CHARS = /[|&;<>$`]/;

function fallbackRead(root) {
  try { return JSON.parse(fs.readFileSync(path.join(root, 'synchrobuilder.json'), 'utf8')); } catch { return null; }
}

function fallbackValidate(obj) {
  const errors = [];
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) errors.push('manifest is not an object');
  else if (obj.version !== 1) errors.push(`unsupported manifest version ${JSON.stringify(obj.version)} (this plugin reads version 1)`);
  return { ok: errors.length === 0, errors, manifest: errors.length ? null : obj };
}

export function fallbackTokenize(str) {
  const out = [];
  let cur = '';
  let quote = null;
  let has = false;
  const s = String(str ?? '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === '\\' && quote === '"' && i + 1 < s.length) cur += s[++i];
      else cur += c;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; has = true; continue; }
    if (c === '\\' && i + 1 < s.length) { cur += s[++i]; has = true; continue; }
    if (/\s/.test(c)) { if (has) { out.push(cur); cur = ''; has = false; } continue; }
    if (SHELL_CHARS.test(c)) throw new Error(`shell syntax "${c}" is not allowed in manifest commands (audit rule shell-syntax); put pipelines in a Node script`);
    cur += c; has = true;
  }
  if (quote) throw new Error('unterminated quote in manifest command');
  if (has) out.push(cur);
  return out;
}

async function tryImport(spec) {
  try { return await import(spec); } catch (err) {
    if (err && (err.code === 'ERR_MODULE_NOT_FOUND' || err.code === 'MODULE_NOT_FOUND')) return null;
    throw err;
  }
}

/** loadManifestModules() -> { readManifest, validateManifest, tokenizeCommand, source }. */
export async function loadManifestModules() {
  const io = await tryImport('../manifest/io.mjs');
  const schema = await tryImport('../manifest/schema.mjs');
  return {
    readManifest: io && typeof io.readManifest === 'function' ? io.readManifest : fallbackRead,
    validateManifest: (schema && schema.validateManifest) || (io && io.validateManifest) || fallbackValidate,
    tokenizeCommand: (schema && schema.tokenizeCommand) || (io && io.tokenizeCommand) || fallbackTokenize,
    source: io && schema ? 'manifest' : 'fallback',
  };
}
