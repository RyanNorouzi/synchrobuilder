// init: write synchrobuilder.json, the manifest a teammate's machine is set up from.
//   synchrobuilder init [path] [--refresh] [--team [--yes]] [--json]
import path from 'node:path';
import fs from 'node:fs';
import { detectProject } from '../manifest/detect.mjs';
import { readManifest, writeManifest, formatManifest, manifestPath } from '../manifest/io.mjs';
import { locate } from '../core/paths.mjs';
import { git } from '../core/proc.mjs';
import { handleFromEmail } from '../state/identity.mjs';
import { readTeam } from '../core/config.mjs';

/** Propose handles from the repository's own commit authors. Names and emails are already public in git history. */
export function proposeTeam(workTree) {
  const r = git(['-C', workTree, 'shortlog', '-sne', '--all', '--no-merges'], { timeoutMs: 10000 });
  if (r.code !== 0) return { members: {}, error: 'could not read git history' };
  const members = {};
  for (const line of r.stdout.split('\n')) {
    const m = line.match(/^\s*\d+\s+(.+?)\s+<([^>]+)>\s*$/);
    if (!m) continue;
    const email = m[2].trim().toLowerCase();
    if (/noreply|users\.noreply\.github\.com|synchrobuilder\.invalid/.test(email)) continue;
    const handle = handleFromEmail(email);
    if (!handle) continue;
    if (!members[handle]) members[handle] = { name: m[1].trim().slice(0, 80), emails: [] };
    if (!members[handle].emails.includes(email)) members[handle].emails.push(email);
  }
  return { members };
}

function describeUnsure(unsure) {
  const lines = [];
  for (const u of unsure) lines.push(`  ${u.field}: ${u.reason}`);
  return lines;
}

export async function run({ args, flags, cwd, stdout, stderr }) {
  const root = path.resolve(cwd, args[0] || '.');
  if (!fs.existsSync(root)) { stderr.write(`No such directory: ${root}\n`); return 1; }
  const read = readManifest(root);
  const existing = read.exists ? (read.manifest || read.raw || null) : null;
  if (read.exists && !read.ok && !flags.refresh) {
    stderr.write(`${read.path} has problems:\n${read.errors.map((e) => `  ${e}`).join('\n')}\nRe-detect and overwrite with: synchrobuilder init --refresh\n`);
    return 1;
  }

  if (flags.team) {
    const loc = locate(root);
    if (!loc) { stderr.write('Not inside a git repository, so there is no history to read handles from.\n'); return 1; }
    const proposal = proposeTeam(loc.workTree);
    const current = readTeam(loc.workTree);
    const merged = { version: 1, members: { ...proposal.members, ...current.members } };
    const file = path.join(loc.workTree, '.synchrobuilder', 'team.json');
    stdout.write(`Proposed .synchrobuilder/team.json (${Object.keys(merged.members).length} handles from git history):\n\n${JSON.stringify(merged, null, 2)}\n\n`);
    if (!flags.yes) { stdout.write(`Nothing was written. To write it: synchrobuilder init --team --yes\nIt contains names and emails that are already in your git history, and it is meant to be committed.\n`); return 0; }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(merged, null, 2) + '\n');
    stdout.write(`Wrote ${path.relative(root, file) || file}. Commit it so teammates share the same handles.\n`);
    return 0;
  }

  if (existing && !flags.refresh) {
    if (flags.json) { stdout.write(JSON.stringify({ existing: true, manifest: existing }, null, 2) + '\n'); return 0; }
    stdout.write(`${manifestPath(root)} already exists:\n\n${formatManifest(existing)}\nRe-detect and show what changed with: synchrobuilder init --refresh\n`);
    return 0;
  }

  const detected = detectProject(root);
  if (!detected.hasProjectFiles) {
    stderr.write('Found no package.json, Python project or Makefile here, so there is nothing to describe yet.\n');
    return 1;
  }
  if (flags.json) {
    stdout.write(JSON.stringify({ manifest: detected.manifest, unsure: detected.unsure, errors: detected.errors, sources: detected.sources }, null, 2) + '\n');
    if (!flags.refresh || !existing) writeManifest(root, detected.manifest);
    return 0;
  }

  if (existing && flags.refresh) {
    const before = formatManifest(existing);
    const after = formatManifest(detected.manifest);
    if (before === after) { stdout.write('No change: the manifest already matches what is on disk.\n'); return 0; }
    stdout.write('Detected changes to synchrobuilder.json:\n\n');
    const b = before.split('\n');
    const a = after.split('\n');
    for (let i = 0; i < Math.max(b.length, a.length); i++) {
      if (b[i] !== a[i]) {
        if (b[i] !== undefined) stdout.write(`  - ${b[i]}\n`);
        if (a[i] !== undefined) stdout.write(`  + ${a[i]}\n`);
      }
    }
    stdout.write('\n');
  }

  writeManifest(root, detected.manifest);
  stdout.write(`Wrote ${manifestPath(root)}\n\n${formatManifest(detected.manifest)}\n`);
  if (detected.errors.length) {
    stdout.write('The manifest has problems that need a human:\n');
    for (const e of detected.errors) stdout.write(`  ${e}\n`);
    stdout.write('\n');
  }
  if (detected.unsure.length) {
    stdout.write('Please check these; they were guessed:\n');
    for (const line of describeUnsure(detected.unsure)) stdout.write(`${line}\n`);
    stdout.write('\n');
  }
  stdout.write('Environment variables are recorded as names and descriptions only; values are never read or written.\n');
  stdout.write('Next: commit it, then a teammate runs "synchrobuilder setup" on their machine.\n');
  return 0;
}
