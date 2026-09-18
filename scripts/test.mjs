#!/usr/bin/env node
// Runs every tests/**/*.test.mjs through node --test (works the same on Node 20 and 24, no glob support needed).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function walk(dir, out = []) { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p, out); else if (e.name.endsWith('.test.mjs')) out.push(p); } return out; }
const filter = process.argv[2];
const files = walk(path.join(repo, 'tests')).filter((f) => !filter || f.includes(filter));
const r = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit', cwd: repo });
process.exit(r.status === null ? 1 : r.status);
