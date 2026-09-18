#!/usr/bin/env node
// Repository checks that need no dependencies: every .mjs parses, no file over 500 lines, skills up to date, no shell scripts in the plugin.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'dist', '.claude-flow', '.claude'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
const files = walk(repo);
for (const f of files) {
  const rel = path.relative(repo, f);
  if (f.endsWith('.mjs') || f.endsWith('.js')) {
    const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
    if (r.status !== 0) problems.push(`${rel}: ${r.stderr.trim().split('\n')[0]}`);
  }
  if (/\.(mjs|js|md|json|css|html|yml)$/.test(f) && !rel.startsWith('docs/research/evidence/')) {
    const lines = fs.readFileSync(f, 'utf8').split('\n').length;
    if (lines > 500) problems.push(`${rel}: ${lines} lines (limit 500)`);
  }
  if (rel.startsWith('plugins/synchrobuilder/') && /\.(sh|bash|ps1|cmd|bat)$/.test(f)) problems.push(`${rel}: shell script inside the plugin`);
}
const skills = spawnSync(process.execPath, [path.join(repo, 'scripts', 'gen-skills.mjs'), '--check'], { encoding: 'utf8' });
if (skills.status !== 0) problems.push(skills.stderr.trim() || 'skills out of date');
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
console.log(`lint passed (${files.length} files)`);
