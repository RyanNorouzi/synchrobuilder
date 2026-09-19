// Test rig for the multiplayer features: a temp SYNCHROBUILDER_HOME, a fake git checkout (a .git directory with a config, no
// git binary needed), an identity file and a snapshot.json placed exactly where lib/core/paths.mjs expects them.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { locate, realPath } from '../../plugins/synchrobuilder/lib/core/paths.mjs';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const pluginRoot = path.join(repoRoot, 'plugins', 'synchrobuilder');
export const NOW = Date.parse('2026-09-18T12:00:00Z');
export const REMOTE_URL = 'https://example.com/acme/repo.git';

export function loadFixture(name = 'team') {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, 'tests', 'fixtures', 'snapshots', `${name}.json`), 'utf8'));
}

/** Creates the rig. Sets process.env.SYNCHROBUILDER_HOME for in-process calls; the same value goes to spawned CLIs. */
export async function makeRig({ snapshot = loadFixture(), identity = { handle: 'alice', device: 'aaaaaaaa', source: 'team.json' }, config, team, prefix = 'sb-feat-' } = {}) {
  const home = realPath(fs.mkdtempSync(path.join(os.tmpdir(), prefix))); // realpath: on macOS tmpdir is a symlink and a child's process.cwd() resolves it
  process.env.SYNCHROBUILDER_HOME = home;
  const repo = path.join(home, 'repo');
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.git', 'config'), `[core]\n\tbare = false\n[remote "origin"]\n\turl = ${REMOTE_URL}\n`);
  fs.mkdirSync(path.join(repo, 'src', 'api'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'src', 'shared'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'api', 'users.ts'), 'export const a = 1;\n');
  if (config || team) {
    fs.mkdirSync(path.join(repo, '.synchrobuilder'), { recursive: true });
    if (config) fs.writeFileSync(path.join(repo, '.synchrobuilder', 'config.json'), JSON.stringify(config));
    if (team) fs.writeFileSync(path.join(repo, '.synchrobuilder', 'team.json'), JSON.stringify(team));
  }
  const loc = locate(repo);
  fs.mkdirSync(loc.checkoutDir, { recursive: true });
  fs.mkdirSync(loc.remoteDir, { recursive: true });
  if (identity) fs.writeFileSync(path.join(loc.checkoutDir, 'identity.json'), JSON.stringify(identity));
  const rig = {
    home, repo, loc, checkoutDir: loc.checkoutDir, remoteDir: loc.remoteDir,
    snapshotFile: path.join(loc.remoteDir, 'snapshot.json'),
    writeSnapshot(s) { if (s === null) { try { fs.unlinkSync(rig.snapshotFile); } catch { /* none */ } } else fs.writeFileSync(rig.snapshotFile, JSON.stringify(s)); },
    journal(events) { fs.appendFileSync(path.join(loc.checkoutDir, 'journal.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n'); },
    readJournal() { try { return fs.readFileSync(path.join(loc.checkoutDir, 'journal.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } },
    readJson(rel) { try { return JSON.parse(fs.readFileSync(path.join(loc.checkoutDir, rel), 'utf8')); } catch { return null; } },
    ctx(overrides = {}) {
      return { cwd: repo, loc, sessionId: 'sess-1', muted: false, permissionMode: 'default', snapshotFile: rig.snapshotFile, sessionFile: path.join(loc.checkoutDir, 'sessions', 'sess-1.json'), now: NOW, ...overrides };
    },
    env(extra = {}) { return { ...process.env, SYNCHROBUILDER_HOME: home, ...extra }; },
  };
  if (snapshot) rig.writeSnapshot(snapshot);
  return rig;
}

export function iso(offsetMinutes, base = NOW) { return new Date(base + offsetMinutes * 60_000).toISOString(); }
