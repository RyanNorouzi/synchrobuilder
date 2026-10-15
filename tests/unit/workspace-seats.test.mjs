// Seats: one participant per working tree. These are the assertions that keep two agents in two worktrees
// from collapsing back into one identity, which is how it behaved before seats existed.
// (Named workspace-seats to stay clear of seats.test.mjs, which covers the pricing seat count.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

process.env.SYNCHROBUILDER_HOME = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'sb-seat-'));

import { workspaceKey, checkoutDir, locate } from '../../plugins/synchrobuilder/lib/core/paths.mjs';
import { isSeat } from '../../plugins/synchrobuilder/lib/core/schema.mjs';
import { parseWriterRef, writerKey, GitRefsTransport } from '../../plugins/synchrobuilder/lib/transport/git-refs.mjs';
import { isSelf, teammates, siblings, remoteWriters } from '../../plugins/synchrobuilder/lib/features/common.mjs';
import { foldSnapshot } from '../../plugins/synchrobuilder/lib/worker/fold.mjs';

const SEAT_A = 'a1b2c3d4e5f60718';
const SEAT_B = '0718f6e5d4c3b2a1';
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });

test('a seat is sixteen hex characters and nothing else', () => {
  assert.equal(isSeat(SEAT_A), true);
  for (const bad of ['', 'xyz', 'A1B2C3D4E5F60718', 'a1b2c3d4', 'a1b2c3d4e5f607189', null, 42, undefined]) {
    assert.equal(isSeat(bad), false, `${String(bad)} must not be a seat`);
  }
});

test('each worktree gets its own key; a plain clone keeps the key it always had', () => {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'sb-wt-'));
  try {
    const main = path.join(root, 'main');
    fs.mkdirSync(main, { recursive: true });
    git(main, 'init', '-q');
    git(main, 'config', 'user.email', 'a@example.com');
    git(main, 'config', 'user.name', 'a');
    fs.writeFileSync(path.join(main, 'f.txt'), 'x\n');
    git(main, 'add', '-A');
    git(main, 'commit', '-q', '-m', 'init');
    git(main, 'worktree', 'add', '-q', path.join(root, 'wt-a'), '-b', 'agent-a');
    git(main, 'worktree', 'add', '-q', path.join(root, 'wt-b'), '-b', 'agent-b');

    const m = locate(main);
    const a = locate(path.join(root, 'wt-a'));
    const b = locate(path.join(root, 'wt-b'));
    assert.ok(m && a && b, 'all three resolve');

    assert.equal(new Set([m.seat, a.seat, b.seat]).size, 3, 'three distinct seats');
    assert.equal(new Set([m.checkoutDir, a.checkoutDir, b.checkoutDir]).size, 3, 'three distinct state dirs');
    for (const loc of [m, a, b]) assert.equal(isSeat(loc.seat), true);

    // They still share one common dir, which is exactly what used to collapse them.
    assert.equal(a.commonDir, b.commonDir);
    assert.notEqual(a.gitDir, b.gitDir);

    // A plain clone's key is unchanged by the switch from commonDir to gitDir, so no existing state moves.
    assert.equal(m.gitDir, m.commonDir, 'a plain checkout has one git dir');
    assert.equal(m.checkoutDir, checkoutDir(m.commonDir), 'the old derivation gives the same directory');
    assert.equal(workspaceKey(m.gitDir), workspaceKey(m.commonDir));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('writer refs carry the seat, and refs from before seats still parse', () => {
  const withSeat = `refs/sb-remote/custom/v1/alice/aabbccdd/${SEAT_A}`;
  assert.deepEqual(parseWriterRef(withSeat), { handle: 'alice', device: 'aabbccdd', seat: SEAT_A, namespace: 'custom' });
  assert.deepEqual(parseWriterRef('refs/sb-remote/custom/v1/alice/aabbccdd'), { handle: 'alice', device: 'aabbccdd', seat: null, namespace: 'custom' });
  assert.equal(parseWriterRef(`refs/sb-remote/heads/v1/alice/aabbccdd/${SEAT_B}`).namespace, 'branch');

  assert.notEqual(writerKey({ handle: 'a', device: 'dd', seat: SEAT_A }), writerKey({ handle: 'a', device: 'dd', seat: SEAT_B }));
  assert.notEqual(writerKey({ handle: 'a', device: 'dd', seat: null }), writerKey({ handle: 'a', device: 'dd', seat: SEAT_A }));

  for (const bad of [
    'refs/sb-remote/custom/v1/alice',
    `refs/sb-remote/custom/v1/alice/aabbccdd/${SEAT_A}/extra`,
    'refs/sb-remote/custom/v1/alice/NOTHEX/' + SEAT_A,
    'refs/sb-remote/custom/v1/alice/aabbccdd/nothex',
    'refs/heads/main',
  ]) assert.equal(parseWriterRef(bad), null, `must refuse ${bad}`);
});

test('the transport publishes to a three-segment ref, and to the old shape without a seat', () => {
  const base = { remoteUrl: 'https://example.invalid/r.git', remoteDir: process.env.SYNCHROBUILDER_HOME, handle: 'alice', device: 'aabbccdd' };
  assert.equal(new GitRefsTransport({ ...base, seat: SEAT_A }).customRef, `refs/synchrobuilder/v1/alice/aabbccdd/${SEAT_A}`);
  assert.equal(new GitRefsTransport({ ...base, seat: SEAT_A }).branchRef, `refs/heads/synchrobuilder/v1/alice/aabbccdd/${SEAT_A}`);
  assert.equal(new GitRefsTransport({ ...base }).customRef, 'refs/synchrobuilder/v1/alice/aabbccdd');
  assert.equal(new GitRefsTransport({ ...base, seat: 'nope' }).customRef, 'refs/synchrobuilder/v1/alice/aabbccdd');
});

test('isSelf is per seat, so a sibling agent is a teammate and not me', () => {
  const me = { handle: 'alice', device: 'dddddddd', seat: SEAT_A };
  assert.equal(isSelf({ ...me }, me), true, 'my own seat is me');
  assert.equal(isSelf({ handle: 'alice', device: 'dddddddd', seat: SEAT_B }, me), false, 'another worktree of mine is not me');
  assert.equal(isSelf({ handle: 'bob', device: 'eeeeeeee', seat: SEAT_A }, me), false);
  assert.equal(isSelf({ handle: 'alice', device: 'ffffffff', seat: SEAT_A }, me), false, 'the same seat id on another machine is not me');
});

test('a writer from before seats is still me, so an upgrade never shows my own work as a stranger', () => {
  const me = { handle: 'alice', device: 'dddddddd', seat: SEAT_A };
  assert.equal(isSelf({ handle: 'alice', device: 'dddddddd', seat: null }, me), true, 'my own pre-seat ref');
  const preSeatMe = { handle: 'alice', device: 'dddddddd', seat: null };
  assert.equal(isSelf({ handle: 'alice', device: 'dddddddd', seat: SEAT_A }, preSeatMe), true, 'local state not re-resolved yet');
  assert.equal(isSelf({ handle: 'bob', device: 'dddddddd', seat: null }, me), false, 'a different handle is never me');
});

test('teammates, siblings and remote writers are three different questions', () => {
  const me = { handle: 'alice', device: 'dddddddd', seat: SEAT_A };
  const snapshot = {
    writers: [
      { handle: 'alice', device: 'dddddddd', seat: SEAT_A },
      { handle: 'alice', device: 'dddddddd', seat: SEAT_B },
      { handle: 'bob', device: 'eeeeeeee', seat: SEAT_A },
    ],
  };
  assert.deepEqual(teammates(snapshot, me).map((w) => `${w.seat}/${w.handle}`), [`${SEAT_B}/alice`, `${SEAT_A}/bob`]);
  assert.deepEqual(siblings(snapshot, me).map((w) => w.seat), [SEAT_B], 'only the other seat on this machine');
  assert.deepEqual(remoteWriters(snapshot, me).map((w) => w.handle), ['bob'], 'only writers from elsewhere');
});

test('the fold keeps every seat and marks which came off this machine', () => {
  const own = [
    { handle: 'alice', device: 'dddddddd', seat: SEAT_A, sha: 'a1', presence: null, claims: [] },
    { handle: 'alice', device: 'dddddddd', seat: SEAT_B, sha: 'b1', presence: null, claims: [] },
  ];
  const snap = foldSnapshot({ writers: [], own, transport: { mode: 'custom' }, now: Date.now(), localDevice: 'dddddddd' });
  assert.equal(snap.writers.length, 2, 'both seats survive the fold; neither overwrites the other');
  assert.deepEqual(snap.writers.map((w) => w.seat).sort(), [SEAT_A, SEAT_B].sort());
  for (const w of snap.writers) {
    assert.equal(w.local, true, 'both came off this disk');
    assert.equal('self' in w, false, 'the fold does not decide self; the reader does');
  }
});
