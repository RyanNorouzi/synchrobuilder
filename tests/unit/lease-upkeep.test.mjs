// The worker's lease upkeep against a fake remote: letting go, renewing, noticing a lease that changed hands, and
// collecting what nobody has renewed. The clock is passed in, so every expiry here is exact.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeRig, NOW } from './features-rig.mjs';
import { fakeStore, seat, SEAT_A, SEAT_B, MIN } from './lease-rig.mjs';
import { acquireLease, hashOfPath } from '../../plugins/synchrobuilder/lib/features/leases.mjs';
import { readRecord, releaseRecords, listRecords } from '../../plugins/synchrobuilder/lib/features/lease-table.mjs';
import { maintainLeases, leaseViewFile } from '../../plugins/synchrobuilder/lib/worker/leases.mjs';
import { leaseRows } from '../../plugins/synchrobuilder/lib/features/lease-view.mjs';
import { validLease } from '../../plugins/synchrobuilder/lib/transport/lease-refs.mjs';

const take = (s, rel, extra = {}) => acquireLease({ loc: s.loc, identity: s.identity, sid: s.sid, rel, now: NOW, ...extra });
const upkeep = (rig, store, now = NOW) => maintainLeases({ remoteDir: rig.remoteDir, store, now, ttlMs: 10 * MIN, idleMs: 15 * MIN });
function foreign(store, rel, { handle = 'bob', device = 'bbbbbbbb', at = NOW - MIN, exp = NOW + 9 * MIN } = {}) {
  const doc = { v: 1, handle, device, seat: SEAT_B, path: rel, at: new Date(at).toISOString(), exp: new Date(exp).toISOString() };
  store.refs.set(hashOfPath(rel), { sha: 'e'.repeat(40), doc: validLease(doc, NOW) });
}

test('a live lease is left alone until half its life is gone, then renewed by compare-and-swap', async () => {
  const rig = await makeRig({});
  const store = fakeStore();
  const a = seat(rig, SEAT_A);
  take(a, 'a.ts', { store });
  const first = store.refs.get(hashOfPath('a.ts')).sha;
  assert.deepEqual(upkeep(rig, store, NOW + 4 * MIN), { released: 0, renewed: 0, contested: 0, collected: 0, remote: 'ok' });
  assert.equal(store.refs.get(hashOfPath('a.ts')).sha, first);
  // Still being worked on: the hook touches the record on every edit.
  take(a, 'a.ts', { store, now: NOW + 5 * MIN });
  assert.equal(upkeep(rig, store, NOW + 6 * MIN).renewed, 1);
  const renewed = store.refs.get(hashOfPath('a.ts'));
  assert.notEqual(renewed.sha, first);
  assert.equal(renewed.doc.exp, new Date(NOW + 16 * MIN).toISOString());
  assert.equal(readRecord(rig.remoteDir, hashOfPath('a.ts')).remote.sha, renewed.sha);
});

test('a lease is let go, and its ref deleted, when the session ends, the file goes idle, or it is released', async () => {
  const rig = await makeRig({});
  const store = fakeStore();
  const a = seat(rig, SEAT_A);
  take(a, 'ended.ts', { store }); take(a, 'idle.ts', { store }); take(a, 'released.ts', { store }); take(a, 'kept.ts', { store });
  releaseRecords(rig.remoteDir, (r) => r.path === 'released.ts');
  assert.equal(upkeep(rig, store).released, 1);
  assert.equal(store.refs.has(hashOfPath('released.ts')), false);
  take(a, 'kept.ts', { store, now: NOW + 14 * MIN });
  take(a, 'ended.ts', { store, now: NOW + 14 * MIN });
  assert.equal(upkeep(rig, store, NOW + 16 * MIN).released, 1, 'idle.ts was not touched for 15 minutes');
  assert.equal(store.refs.has(hashOfPath('idle.ts')), false);
  a.close();
  assert.equal(upkeep(rig, store, NOW + 17 * MIN).released, 2);
  assert.equal(store.refs.size, 0);
  assert.equal(listRecords(rig.remoteDir).length, 0);
});

test('offline: a release waits for the remote instead of being forgotten, and a lease taken locally is pushed later', async () => {
  const rig = await makeRig({});
  const store = fakeStore();
  const a = seat(rig, SEAT_A);
  take(a, 'r.ts', { store });
  store.fail = 'network';
  take(a, 'local-only.ts', { store });
  releaseRecords(rig.remoteDir, (r) => r.path === 'r.ts');
  assert.deepEqual([upkeep(rig, store).released, upkeep(rig, store).remote], [0, 'failed']);
  assert.equal(readRecord(rig.remoteDir, hashOfPath('r.ts')).state, 'releasing', 'kept, so the ref is deleted when the network returns');
  assert.equal(upkeep(rig, null).released, 0, 'the same with no remote store at all this tick');
  store.fail = null;
  const back = upkeep(rig, store);
  assert.deepEqual([back.released, back.renewed], [1, 1]);
  assert.equal(store.refs.has(hashOfPath('r.ts')), false);
  assert.equal(store.refs.get(hashOfPath('local-only.ts')).doc.handle, 'alice');
  // A release that could never reach the remote stops mattering once the lease has expired past the grace period.
  take(a, 'z.ts', { store });
  releaseRecords(rig.remoteDir, (r) => r.path === 'z.ts');
  store.fail = 'network';
  assert.equal(upkeep(rig, store, NOW + 13 * MIN).released, 1);
});

test('a lease that changed hands on the remote is flagged at the next tick, and the next edit is refused', async () => {
  const rig = await makeRig({});
  const store = fakeStore();
  const a = seat(rig, SEAT_A);
  take(a, 'mine.ts', { store });
  foreign(store, 'mine.ts');   // a forced takeover: the ref now names someone else, and alice pushed nothing
  assert.equal(upkeep(rig, store).contested, 1);
  const rec = readRecord(rig.remoteDir, hashOfPath('mine.ts'));
  assert.deepEqual([rec.contested, rec.remote], [true, null]);
  const next = take(a, 'mine.ts', { store });
  assert.equal(next.status, 'denied');
  assert.equal(next.holder.handle, 'bob');
  assert.equal(readRecord(rig.remoteDir, hashOfPath('mine.ts')), null);
});

test('a ref that vanished is simply taken again; a lease taken offline that someone else holds is flagged, never fought over', async () => {
  const rig = await makeRig({});
  const store = fakeStore();
  const a = seat(rig, SEAT_A);
  take(a, 'gone.ts', { store });
  store.refs.delete(hashOfPath('gone.ts'));
  assert.equal(upkeep(rig, store).contested, 0);
  assert.equal(upkeep(rig, store).renewed, 1);
  assert.equal(store.refs.get(hashOfPath('gone.ts')).doc.handle, 'alice');

  store.fail = 'network';
  take(a, 'offline.ts', { store });
  store.fail = null;
  foreign(store, 'offline.ts');
  assert.equal(upkeep(rig, store).contested, 1);
  assert.equal(store.refs.get(hashOfPath('offline.ts')).doc.handle, 'bob', 'bob keeps it');
});

test('refs nobody has renewed for an hour are collected; unreadable ones too; live ones never', async () => {
  const rig = await makeRig({});
  const store = fakeStore();
  foreign(store, 'live.ts');
  foreign(store, 'just-expired.ts', { exp: NOW - 5 * MIN });
  foreign(store, 'long-dead.ts', { at: NOW - 3 * 60 * MIN, exp: NOW - 61 * MIN });
  store.refs.set('d'.repeat(40), { sha: 'c'.repeat(40), doc: null });
  const a = seat(rig, SEAT_A);
  take(a, 'own.ts');
  assert.equal(upkeep(rig, store).collected, 2);
  assert.deepEqual([...store.refs.keys()].sort(), [hashOfPath('live.ts'), hashOfPath('just-expired.ts'), hashOfPath('own.ts')].sort());
  const view = JSON.parse(fs.readFileSync(leaseViewFile(rig.remoteDir), 'utf8'));
  assert.deepEqual(view.leases.map((l) => l.path).sort(), ['live.ts', 'own.ts'], 'an expired lease is not shown as held');
  const rows = leaseRows({ remoteDir: rig.remoteDir, identity: a.identity, now: NOW });
  assert.deepEqual(rows.map((r) => [r.path, r.where, r.handle]).sort(), [['live.ts', 'remote', 'bob'], ['own.ts', 'you', 'alice']]);
  const fromSibling = leaseRows({ remoteDir: rig.remoteDir, identity: { ...a.identity, seat: SEAT_B }, now: NOW });
  assert.equal(fromSibling.find((r) => r.path === 'own.ts').where, 'here');
});
