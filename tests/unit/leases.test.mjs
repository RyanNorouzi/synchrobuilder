// Leases on one machine and against a fake remote store: who gets the file, who is refused, and when a dead holder stops counting.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeRig, NOW } from './features-rig.mjs';
import { acquireLease, remoteLeasesWanted, hashOfPath, GRACE_MS } from '../../plugins/synchrobuilder/lib/features/leases.mjs';
import { listRecords, readRecord, releaseRecords, withTable } from '../../plugins/synchrobuilder/lib/features/lease-table.mjs';
import { leaseHash, validLease, encodeLease, decodeLease } from '../../plugins/synchrobuilder/lib/transport/lease-refs.mjs';
import { leaseGuard } from '../../plugins/synchrobuilder/lib/features/lease-guard.mjs';
import { fakeStore, seat, SEAT_A, SEAT_B, MIN } from './lease-rig.mjs';

const take = (s, rel, extra = {}) => acquireLease({ loc: s.loc, identity: s.identity, sid: s.sid, rel, now: NOW, ...extra });
const asBob = (s) => ({ ...s, identity: { handle: 'bob', device: 'bbbbbbbb', seat: SEAT_B } });

test('the first agent to touch a file holds it; a second agent on the same machine is refused', async () => {
  const rig = await makeRig({});
  const a = seat(rig, SEAT_A);
  const b = seat(rig, SEAT_B);
  assert.equal(take(a, 'src/api/users.ts').status, 'acquired');
  assert.equal(take(a, 'src/api/users.ts').status, 'held');
  const refused = take(b, 'src/api/users.ts');
  assert.equal(refused.status, 'denied');
  assert.deepEqual([refused.holder.local, refused.holder.seat], [true, SEAT_A]);
  assert.equal(take(b, 'src/api/other.ts').status, 'acquired', 'a different file is free');
  assert.equal(take(b, 'SRC/API/Users.ts').status, 'denied', 'the same file under another case is the same lease');
  assert.equal(listRecords(rig.remoteDir).length, 2);
});

test('a lease stops counting when its session ends, goes idle, or is released', async () => {
  const rig = await makeRig({});
  const a = seat(rig, SEAT_A);
  const b = seat(rig, SEAT_B);
  take(a, 'one.ts'); take(a, 'two.ts'); take(a, 'three.ts');
  assert.equal(take(b, 'one.ts', { now: NOW + 16 * MIN }).status, 'acquired', 'untouched for longer than the idle window');
  assert.equal(take(b, 'two.ts', { now: NOW + 14 * MIN }).status, 'denied', 'still inside the idle window');
  assert.equal(releaseRecords(rig.remoteDir, (r) => r.checkoutDir === a.checkoutDir && r.path === 'two.ts'), 1);
  assert.equal(take(b, 'two.ts').status, 'acquired', 'released');
  a.close();
  assert.equal(take(b, 'three.ts').status, 'acquired', 'the holding session closed');
});

test('a holder whose process is gone holds nothing', async () => {
  const rig = await makeRig({});
  const dead = seat(rig, SEAT_A, { live: false });
  const b = seat(rig, SEAT_B);
  assert.equal(take(dead, 'x.ts').status, 'acquired');
  assert.equal(take(b, 'x.ts').status, 'acquired');
  assert.equal(readRecord(rig.remoteDir, hashOfPath('x.ts')).seat, SEAT_B);
});

test('the table mutex serialises mutations and recovers from an abandoned lock', async () => {
  const rig = await makeRig({});
  const lock = path.join(rig.remoteDir, 'leases', '.lock');
  fs.mkdirSync(lock, { recursive: true });
  assert.equal(withTable(rig.remoteDir, () => 'ran', 'busy'), 'busy', 'a fresh lock held elsewhere is respected');
  const old = new Date(Date.now() - 10_000);
  fs.utimesSync(lock, old, old);
  assert.equal(withTable(rig.remoteDir, () => 'ran', 'busy'), 'ran', 'a stale lock is cleared');
  assert.equal(fs.existsSync(lock), false);
  const a = seat(rig, SEAT_A);
  fs.mkdirSync(lock);
  assert.equal(take(a, 'y.ts').status, 'open', 'a busy table lets the edit through rather than blocking it');
});

test('across machines: one winner on the remote, the loser is refused and gives the local slot back', async () => {
  const store = fakeStore();
  const rigA = await makeRig({ prefix: 'sb-lease-a-' });
  const a = seat(rigA, SEAT_A);
  const rigB = await makeRig({ prefix: 'sb-lease-b-' });
  const b = asBob(seat(rigB, SEAT_B));
  assert.deepEqual(take(a, 'src/app.ts', { store }), { status: 'acquired', remote: 'ok' });
  const refused = take(b, 'src/app.ts', { store });
  assert.equal(refused.status, 'denied');
  assert.deepEqual([refused.holder.handle, refused.holder.local], ['alice', false]);
  assert.equal(readRecord(rigB.remoteDir, hashOfPath('src/app.ts')), null, 'bob does not keep a local lease he never got');
  const before = store.calls.put;
  assert.deepEqual(take(a, 'src/app.ts', { store }), { status: 'held', remote: 'ok' });
  assert.equal(store.calls.put, before, 'a lease held with time to spare costs no round trip');
});

test('across machines: an expired lease can be taken over only after the grace period, by compare-and-swap', async () => {
  const store = fakeStore();
  const rigA = await makeRig({ prefix: 'sb-lease-a-' });
  const a = seat(rigA, SEAT_A);
  const rigB = await makeRig({ prefix: 'sb-lease-b-' });
  const b = asBob(seat(rigB, SEAT_B));
  take(a, 'f.ts', { store, ttlMs: 10 * MIN });
  assert.equal(take(b, 'f.ts', { store, now: NOW + 10 * MIN + GRACE_MS - 1000 }).status, 'denied', 'expired, but inside the grace period');
  assert.deepEqual(take(b, 'f.ts', { store, now: NOW + 10 * MIN + GRACE_MS + 1000 }), { status: 'acquired', remote: 'ok' });
  // Alice's machine wakes up believing she still holds it. Her renewal is a compare-and-swap on a sha that is gone.
  const woke = take(a, 'f.ts', { store, now: NOW + 13 * MIN });
  assert.equal(woke.status, 'denied');
  assert.equal(woke.holder.handle, 'bob');
});

test('a lease taken over from a dead seat on this machine replaces that seat\'s remote ref', async () => {
  const store = fakeStore();
  const rig = await makeRig({});
  const dead = seat(rig, SEAT_A);
  const b = seat(rig, SEAT_B);
  take(dead, 'h.ts', { store });
  dead.close();
  assert.deepEqual(take(b, 'h.ts', { store }), { status: 'acquired', remote: 'ok' }, 'not refused by a sibling\'s leftover ref');
  assert.equal(store.refs.get(hashOfPath('h.ts')).doc.seat, SEAT_B);
});

test('a remote that cannot be reached never blocks: the local lease stands and the breaker opens', async () => {
  const store = fakeStore();
  store.fail = 'network';
  const rig = await makeRig({});
  const a = seat(rig, SEAT_A);
  assert.deepEqual(take(a, 'g.ts', { store }), { status: 'acquired', remote: 'failed', reason: 'network' });
  const status = { mode: 'custom', lastOkAt: new Date(NOW).toISOString(), publishHeld: null };
  const config = { leases: { remote: 'always' } };
  assert.equal(remoteLeasesWanted({ config, status, identity: a.identity, remoteDir: rig.remoteDir, now: NOW + 1000 }), false, 'breaker open');
  assert.equal(remoteLeasesWanted({ config, status, identity: a.identity, remoteDir: rig.remoteDir, now: NOW + 2 * MIN }), true, 'breaker closed again');
});

test('a remote that refuses lease refs is not mistaken for a lost race, and is left alone for a quarter of an hour', async () => {
  const store = fakeStore();
  store.refusesAll = true;
  const rig = await makeRig({});
  const a = seat(rig, SEAT_A);
  assert.deepEqual(take(a, 'p.ts', { store }), { status: 'acquired', remote: 'failed', reason: 'policy' });
  assert.equal(store.calls.put, 2, 'one retry in case the first refusal was a release racing our push, then stop');
  const status = { mode: 'custom', lastOkAt: new Date(NOW).toISOString(), publishHeld: null };
  const wanted = (now) => remoteLeasesWanted({ config: { leases: { remote: 'always' } }, status, identity: a.identity, remoteDir: rig.remoteDir, now });
  assert.equal(wanted(NOW + 5 * MIN), false);
  assert.equal(wanted(NOW + 16 * MIN), true);
});

test('remote leases are wanted only with a teammate elsewhere, a working hidden namespace, and no public hold', async () => {
  const rig = await makeRig({});
  const identity = { handle: 'alice', device: 'aaaaaaaa', seat: SEAT_A };
  const ok = { mode: 'custom', lastOkAt: new Date(NOW).toISOString(), publishHeld: null };
  const base = { identity, remoteDir: rig.remoteDir, now: NOW };
  const seen = new Date(NOW - MIN).toISOString();
  const teammate = { writers: [{ handle: 'bob', device: 'bbbbbbbb', firstSeenAt: seen }] };
  const onlyMe = { writers: [{ handle: 'alice', device: 'aaaaaaaa', seat: SEAT_B, firstSeenAt: seen }] };
  const longAgo = { writers: [{ handle: 'bob', device: 'bbbbbbbb', firstSeenAt: new Date(NOW - 8 * 24 * 60 * MIN).toISOString() }] };
  const auto = { leases: { remote: 'auto' } };
  assert.equal(remoteLeasesWanted({ ...base, config: auto, status: ok, snapshot: teammate }), true);
  assert.equal(remoteLeasesWanted({ ...base, config: auto, status: ok, snapshot: onlyMe }), false, 'alone: no push, no refs');
  assert.equal(remoteLeasesWanted({ ...base, config: auto, status: ok, snapshot: longAgo }), false, 'a teammate not seen for a week');
  assert.equal(remoteLeasesWanted({ ...base, config: auto, status: { ...ok, publishHeld: 'public-remote' }, snapshot: teammate }), false);
  assert.equal(remoteLeasesWanted({ ...base, config: auto, status: { ...ok, mode: 'branch' }, snapshot: teammate }), false);
  assert.equal(remoteLeasesWanted({ ...base, config: auto, status: null, snapshot: teammate }), false);
  assert.equal(remoteLeasesWanted({ ...base, config: { leases: { remote: 'never' } }, status: ok, snapshot: teammate }), false);
});

test('lease documents: round trip, and a hostile one is dropped rather than repaired', () => {
  const doc = { handle: 'alice', device: 'aaaaaaaa', seat: SEAT_A, path: 'src/a.ts', at: '2026-09-18T12:00:00.000Z', exp: '2026-09-18T12:10:00.000Z' };
  const commit = `tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904\nauthor a <a@b> 1 +0000\ncommitter a <a@b> 1 +0000\n\n${encodeLease(doc)}`;
  const back = decodeLease(commit, NOW);
  assert.deepEqual([back.handle, back.seat, back.path, back.exp], ['alice', SEAT_A, 'src/a.ts', doc.exp]);
  const bad = (patch) => validLease({ v: 1, ...doc, ...patch }, NOW);
  assert.equal(bad({ handle: 'Alice Smith' }), null);
  assert.equal(bad({ device: 'nope' }), null);
  assert.equal(bad({ seat: 'short' }), null);
  assert.equal(bad({ exp: 'tomorrow' }), null);
  assert.equal(bad({ exp: '2027-09-18T12:00:00.000Z' }), null, 'an expiry a year out is not a lease this code writes');
  assert.equal(bad({ v: 2 }), null);
  assert.equal(bad({ path: '../../etc/passwd' }).path, null, 'a traversal path is withheld, the lease itself still reads');
  assert.equal(decodeLease('no blank line', NOW), null);
  assert.equal(decodeLease(`x\n\n${'{'.repeat(3000)}`, NOW), null);
  assert.equal(leaseHash('f:Src/App.ts'), leaseHash('f:src/app.ts'));
  assert.match(leaseHash('f:a'), /^[a-f0-9]{40}$/);
});

function heldByBob(store, rel, seatId = SEAT_B) {
  const doc = { v: 1, handle: 'bob', device: 'bbbbbbbb', seat: seatId, path: rel, at: new Date(NOW - MIN).toISOString(), exp: new Date(NOW + 9 * MIN).toISOString() };
  store.refs.set(hashOfPath(rel), { sha: 'f'.repeat(40), doc: validLease(doc, NOW) });
}

test('the guard: deny by default, warn when asked, silent when off, and never over an unlisted handle', async () => {
  const store = fakeStore();
  heldByBob(store, 'src/api/users.ts');
  const input = { file_path: 'src/api/users.ts' };
  const run = async (config, team) => {
    const rig = await makeRig({ config, team });
    return leaseGuard(rig.ctx(), input, { store, wanted: true });
  };
  const denied = await run();
  assert.equal(denied.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(denied.hookSpecificOutput.permissionDecisionReason, /bob's agent on another machine is editing src\/api\/users\.ts right now/);
  assert.match(denied.hookSpecificOutput.permissionDecisionReason, /synchrobuilder lease take src\/api\/users\.ts --force/);
  assert.match(denied.systemMessage, /held back an edit to src\/api\/users\.ts/);

  const warned = await run({ version: 1, leases: { mode: 'warn' } });
  assert.equal(warned.hookSpecificOutput.permissionDecision, undefined);
  assert.match(warned.hookSpecificOutput.additionalContext, /leases are set to warn, so the edit was allowed/);

  assert.equal(await run({ version: 1, leases: { mode: 'off' } }), null);

  const unlisted = await run(undefined, { version: 1, members: { alice: { name: 'Alice', emails: [] } } });
  assert.equal(unlisted.hookSpecificOutput.permissionDecision, undefined, 'a handle outside team.json is reported, not enforced');
  const listed = await run(undefined, { version: 1, members: { alice: { name: 'Alice', emails: [] }, bob: { name: 'Bob', emails: [] } } });
  assert.equal(listed.hookSpecificOutput.permissionDecision, 'deny');

  const free = await makeRig({});
  assert.equal(await leaseGuard(free.ctx(), { file_path: 'src/shared/free.ts' }, { store, wanted: true }), null, 'a free file is taken and the edit goes ahead');
  assert.equal(store.refs.get(hashOfPath('src/shared/free.ts')).doc.handle, 'alice');
  assert.equal(await leaseGuard(free.ctx(), { file_path: path.join(free.home, 'elsewhere.ts') }, { store, wanted: true }), null, 'outside the repository');
});

test('a refusal is cached briefly, so an immediate retry costs no round trip', async () => {
  const store = fakeStore();
  heldByBob(store, 'src/api/users.ts', null);
  const rig = await makeRig({});
  const input = { file_path: 'src/api/users.ts' };
  await leaseGuard(rig.ctx(), input, { store, wanted: true });
  const puts = store.calls.put;
  const again = await leaseGuard(rig.ctx({ now: NOW + 5000 }), input, { store, wanted: true });
  assert.equal(again.hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(store.calls.put, puts);
  store.refs.clear();
  assert.equal(await leaseGuard(rig.ctx({ now: NOW + 30_000 }), input, { store, wanted: true }), null, 'the cache expires and the freed file is taken');
});
