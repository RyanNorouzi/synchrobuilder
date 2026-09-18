// Reading and writing synchrobuilder.json, plus the tokenizer the runner and the CI generator share.
// The file is UTF-8 JSON with LF line endings and two-space indent; we accept CRLF and a BOM when reading.
import fs from 'node:fs';
import path from 'node:path';
import { readText, writeJsonAtomic } from '../core/fsx.mjs';
import { validateManifest, MANIFEST_FILE, OS_NAMES } from './schema.mjs';

export function manifestPath(root) { return path.join(root, MANIFEST_FILE); }

/** Read and validate the manifest at <root>/synchrobuilder.json. Never throws. */
export function readManifest(root) {
  const file = manifestPath(root);
  const text = readText(file, null);
  if (text === null) return { ok: false, exists: false, errors: [`${MANIFEST_FILE} not found in ${root}`], manifest: null, path: file };
  let parsed;
  try { parsed = JSON.parse(text.replace(/^﻿/, '')); } catch (err) { return { ok: false, exists: true, errors: [`${MANIFEST_FILE}: not valid JSON (${err.message})`], manifest: null, path: file }; }
  const v = validateManifest(parsed);
  return { ok: v.ok, exists: true, errors: v.errors, manifest: v.manifest, path: file };
}

// Stable key order so diffs stay small: spec order for known keys, alphabetical for maps, x- extensions last.
const ORDER = {
  top: ['$schema', 'version', 'name', 'runtimes', 'packageManager', 'services', 'env', 'commands', 'healthCheck', 'os'],
  runtime: ['name', 'version', 'detect'],
  packageManager: ['name', 'version'],
  service: ['name', 'version', 'port', 'hint'],
  env: ['name', 'description', 'required'],
  healthCheck: ['type', 'url', 'expectStatus', 'command', 'timeoutSeconds'],
  osBlock: ['runtimes', 'commands'],
};

function ordered(obj, preferred = []) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  const keys = Object.keys(obj);
  const known = preferred.filter((k) => keys.includes(k));
  const rest = keys.filter((k) => !preferred.includes(k)).sort();
  const out = {};
  for (const k of [...known, ...rest]) if (obj[k] !== undefined && obj[k] !== null) out[k] = obj[k];
  return out;
}

/** Deterministic layout of a manifest object (does not validate). */
export function canonicalManifest(m) {
  const top = ordered(m, ORDER.top);
  if (Array.isArray(top.runtimes)) top.runtimes = top.runtimes.map((r) => ordered(r, ORDER.runtime));
  if (top.packageManager) top.packageManager = ordered(top.packageManager, ORDER.packageManager);
  if (Array.isArray(top.services)) top.services = top.services.map((s) => ordered(s, ORDER.service));
  if (Array.isArray(top.env)) top.env = top.env.map((e) => ordered(e, ORDER.env));
  if (top.commands) top.commands = ordered(top.commands);
  if (top.healthCheck) top.healthCheck = ordered(top.healthCheck, ORDER.healthCheck);
  if (top.os) {
    const os = {};
    for (const name of OS_NAMES) {
      if (!top.os[name]) continue;
      const block = ordered(top.os[name], ORDER.osBlock);
      if (block.commands) block.commands = ordered(block.commands);
      if (Array.isArray(block.runtimes)) block.runtimes = block.runtimes.map((r) => ordered(r, ORDER.runtime));
      os[name] = block;
    }
    top.os = os;
  }
  for (const k of ['runtimes', 'services', 'env']) if (Array.isArray(top[k]) && top[k].length === 0) delete top[k];
  if (top.commands && Object.keys(top.commands).length === 0) delete top.commands;
  if (top.os && Object.keys(top.os).length === 0) delete top.os;
  return top;
}

/** Validate, then write <root>/synchrobuilder.json atomically. Returns { ok, errors, path }. Refuses invalid manifests, including env values. */
export function writeManifest(root, manifest) {
  const v = validateManifest(manifest);
  if (!v.ok) return { ok: false, errors: v.errors, path: manifestPath(root) };
  const file = manifestPath(root);
  fs.mkdirSync(root, { recursive: true });
  writeJsonAtomic(file, canonicalManifest(v.manifest));
  return { ok: true, errors: [], path: file };
}

/** Render the manifest the way writeManifest would (two-space JSON, LF, trailing newline). */
export function formatManifest(manifest) { return JSON.stringify(canonicalManifest(manifest), null, 2) + '\n'; }

/**
 * Split a command string into an argument vector. This is the whole grammar, on purpose:
 *   - arguments are separated by unquoted whitespace;
 *   - "double quotes" and 'single quotes' group text, and may appear inside a word (a"b c"d -> ab cd);
 *   - a backslash outside single quotes escapes the next character (\" \\ \  and so on);
 *   - nothing else is special: no variables, globs, pipes or redirections.
 * Throws a TypeError on an unterminated quote or a trailing backslash.
 */
export function tokenizeCommand(str) {
  const s = String(str);
  const argv = [];
  let cur = '';
  let inWord = false;
  let quote = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote === "'") {
      if (c === "'") quote = null; else cur += c;
      continue;
    }
    if (c === '\\') {
      if (i + 1 >= s.length) throw new TypeError('command ends with a backslash');
      cur += s[++i];
      inWord = true;
      continue;
    }
    if (quote === '"') {
      if (c === '"') quote = null; else cur += c;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; inWord = true; continue; }
    if (c === ' ' || c === '\t') {
      if (inWord) { argv.push(cur); cur = ''; inWord = false; }
      continue;
    }
    cur += c;
    inWord = true;
  }
  if (quote) throw new TypeError(`command has an unterminated ${quote === '"' ? 'double' : 'single'} quote`);
  if (inWord) argv.push(cur);
  return argv;
}
