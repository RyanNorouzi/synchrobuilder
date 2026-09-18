import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeRemoteUrl, parseGitConfig, resolveGitDirs, canonicalPath, remoteKey } from '../../plugins/synchrobuilder/lib/core/paths.mjs';

test('remote URL spellings normalize to one key', () => {
  const forms = ['git@github.com:Acme/Repo.git', 'https://github.com/acme/repo', 'ssh://git@github.com/acme/repo.git', 'https://github.com/acme/repo.git/'];
  const keys = new Set(forms.map(remoteKey));
  assert.equal(keys.size, 1, [...forms.map(normalizeRemoteUrl)].join(' | '));
  assert.notEqual(remoteKey('https://gitlab.example.com/a/b'), remoteKey('https://gitlab.example.com/a/c'));
});

test('git config parser reads remotes and user sections', () => {
  const cfg = parseGitConfig('[core]\n\tbare = false\n[remote "origin"]\n\turl = https://example.com/x.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n[user]\n\temail = "a@b.c" ; comment\n');
  assert.equal(cfg['remote "origin"'].url, 'https://example.com/x.git');
  assert.equal(cfg.user.email, 'a@b.c');
});

test('resolveGitDirs follows a worktree gitdir file and commondir', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-wt-')));
  const common = path.join(root, 'main', '.git');
  fs.mkdirSync(path.join(common, 'worktrees', 'wt1'), { recursive: true });
  fs.writeFileSync(path.join(common, 'config'), '[remote "origin"]\n\turl = https://example.com/r.git\n');
  fs.mkdirSync(path.join(root, 'wt1', 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'wt1', '.git'), `gitdir: ${path.join(common, 'worktrees', 'wt1')}\n`);
  fs.writeFileSync(path.join(common, 'worktrees', 'wt1', 'commondir'), '../..\n');
  const r = resolveGitDirs(path.join(root, 'wt1', 'src'));
  assert.equal(canonicalPath(r.commonDir), canonicalPath(common));
  assert.equal(canonicalPath(r.workTree), canonicalPath(path.join(root, 'wt1')));
});

test('a symlinked checkout path resolves to one key, so hooks and the CLI share one state directory', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-link-')));
  const real = path.join(root, 'real');
  fs.mkdirSync(path.join(real, '.git'), { recursive: true });
  fs.writeFileSync(path.join(real, '.git', 'config'), '[remote "origin"]\n\turl = https://example.com/r.git\n');
  const link = path.join(root, 'link');
  try { fs.symlinkSync(real, link, 'junction'); } catch { return; } // Windows without developer mode
  const viaReal = resolveGitDirs(real);
  const viaLink = resolveGitDirs(link);
  assert.equal(canonicalPath(viaLink.commonDir), canonicalPath(viaReal.commonDir));
  assert.equal(canonicalPath(viaLink.workTree), canonicalPath(viaReal.workTree));
});
