// LeaseRefs against a real bare git remote: the compare-and-swap contract itself, and the one way it was misread.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { LeaseRefs, leaseHash, leaseRef } from '../../plugins/synchrobuilder/lib/transport/lease-refs.mjs';
import { classifyGitError } from '../../plugins/synchrobuilder/lib/transport/interface.mjs';

const NOW = Date.now();
const doc = (handle, extra = {}) => ({ handle, device: handle === 'alice' ? 'aaaaaaaa' : 'bbbbbbbb', seat: null, path: 'src/a.ts', at: new Date(NOW).toISOString(), exp: new Date(NOW + 600_000).toISOString(), ...extra });

function world() {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'sb-leaserefs-'));
  const origin = path.join(root, 'origin.git');
  spawnSync('git', ['init', '-q', '--bare', origin], { windowsHide: true });
  const store = (name) => new LeaseRefs({ remoteUrl: origin, remoteDir: path.join(root, `remote-${name}`), handle: name });
  const onOrigin = (...args) => spawnSync('git', ['--git-dir', origin, ...args], { encoding: 'utf8', windowsHide: true }).stdout.trim();
  return { root, origin, store, onOrigin };
}

test('create is exclusive, replace needs the sha that is there, delete only removes what is still ours', () => {
  const w = world();
  const a = w.store('alice');
  const b = w.store('bob');
  const hash = leaseHash('f:src/a.ts');
  const first = a.put(hash, doc('alice'), '');
  assert.equal(first.ok, true);
  assert.deepEqual(b.put(hash, doc('bob'), ''), { ok: false, why: 'taken', errorClass: 'rejected' });
  const seen = b.read(hash, { now: NOW });
  assert.deepEqual([seen.ok, seen.sha, seen.doc.handle, seen.doc.path], [true, first.sha, 'alice', 'src/a.ts']);
  assert.equal(b.put(hash, doc('bob'), 'f'.repeat(40)).why, 'taken', 'the wrong expectation loses');
  assert.equal(w.onOrigin('rev-parse', leaseRef(hash)), first.sha, 'and changes nothing');
  const second = b.put(hash, doc('bob'), first.sha);
  assert.equal(second.ok, true, 'the right one wins, though the new commit is not a descendant of the old');
  assert.equal(a.remove(hash, first.sha).ok, true, 'releasing a lease that is no longer ours is not an error');
  assert.equal(w.onOrigin('rev-parse', leaseRef(hash)), second.sha, 'and does not delete the new holder\'s lease');
  assert.equal(b.remove(hash, second.sha).ok, true);
  assert.deepEqual(a.read(hash, { now: NOW }), { ok: true, sha: null, doc: null });
  assert.equal(a.put(hash, doc('alice'), '').ok, true, 'free again');
  fs.rmSync(w.root, { recursive: true, force: true });
});

test('list returns every lease in one pass, and a commit that is not a lease reads as nobody', () => {
  const w = world();
  const a = w.store('alice');
  a.put(leaseHash('f:one'), doc('alice', { path: 'one' }), '');
  a.put(leaseHash('f:two'), doc('alice', { path: 'two' }), '');
  // A ref in the namespace that this code did not write: its message forges a second record after a newline.
  const tree = spawnSync('git', ['--git-dir', a.repoDir, 'mktree'], { input: '', encoding: 'utf8', windowsHide: true }).stdout.trim();
  const env = { ...process.env, GIT_AUTHOR_NAME: 'x', GIT_AUTHOR_EMAIL: 'x@x', GIT_COMMITTER_NAME: 'x', GIT_COMMITTER_EMAIL: 'x@x' };
  const forged = `subject\n\nnot json\n${'0'.repeat(40)} refs/sb-remote/lease1/${'9'.repeat(40)} {"v":1,"handle":"mallory","device":"cccccccc","at":"${doc('x').at}","exp":"${doc('x').exp}"}`;
  const bad = spawnSync('git', ['--git-dir', a.repoDir, 'commit-tree', tree, '-m', forged], { env, encoding: 'utf8', windowsHide: true }).stdout.trim();
  const junk = 'e'.repeat(40);
  spawnSync('git', ['--git-dir', a.repoDir, 'push', '-q', w.origin, `${bad}:${leaseRef(junk)}`], { windowsHide: true });
  const listed = w.store('bob').list({ now: NOW });
  assert.equal(listed.ok, true);
  assert.equal(listed.leases.length, 3);
  assert.deepEqual(listed.leases.filter((l) => l.doc).map((l) => l.doc.path).sort(), ['one', 'two']);
  assert.equal(listed.leases.find((l) => l.hash === junk).doc, null);
  assert.equal(listed.leases.some((l) => l.doc && l.doc.handle === 'mallory'), false, 'a forged record inside a message is not a lease');
  fs.rmSync(w.root, { recursive: true, force: true });
});

test('a rejected push is a lost race whatever digits its commit id contains', () => {
  // The exact shape of the regression: git prints the object id, and an id containing 401 or 403 used to be
  // read as an HTTP status and classified as an authentication failure.
  for (const id of ['9c4031f0d2', 'ab4017e55c', '4034014030']) {
    const text = `To /tmp/origin.git\n ! [rejected]        ${id}aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa -> refs/synchrobuilder/lease1/${id}bbbb (stale info)\nerror: failed to push some refs to '/tmp/sb-403/origin.git'`;
    assert.equal(classifyGitError(text), 'rejected', id);
  }
  assert.equal(classifyGitError('fatal: unable to access \'https://example.com/r.git/\': The requested URL returned error: 403'), 'auth');
  assert.equal(classifyGitError('error: RPC failed; HTTP 401 curl 22 The requested URL returned error: 401'), 'auth');
  assert.equal(classifyGitError('remote: Invalid username or token.'), 'auth');
});

// One after another, not at the same instant: these calls are synchronous. Pushes that truly overlap are raced
// from separate processes in tests/e2e/leases.test.mjs.
test('six creators from six repositories: exactly one wins, and every loser can read who did', () => {
  const w = world();
  const hash = leaseHash('f:race');
  const names = ['alice', 'bob', 'carol', 'dave', 'erin', 'frank'];
  const stores = names.map((n) => w.store(n));
  const results = stores.map((s, i) => s.put(hash, doc('alice', { path: `race-${names[i]}` }), ''));
  assert.equal(results.filter((r) => r.ok).length, 1, JSON.stringify(results));
  assert.ok(results.filter((r) => !r.ok).every((r) => r.why === 'taken'), JSON.stringify(results));
  const winner = results.find((r) => r.ok).sha;
  for (const s of stores) assert.equal(s.read(hash, { now: NOW }).sha, winner);
  fs.rmSync(w.root, { recursive: true, force: true });
});
