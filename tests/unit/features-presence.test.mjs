import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFixture, NOW, iso } from './features-rig.mjs';
import { activeWriters, relevantWriters, handlesActiveWithin } from '../../plugins/synchrobuilder/lib/features/presence.mjs';
import { normalizeSnapshot, tierOf, presenceAgeMs, repoRelativePath } from '../../plugins/synchrobuilder/lib/features/common.mjs';
import { readJournalTail, appendJournal, recentEdits } from '../../plugins/synchrobuilder/lib/features/journal-write.mjs';
import { makeRig } from './features-rig.mjs';

const me = { handle: 'alice', device: 'aaaaaaaa' };

test('activeWriters: self excluded by handle+device, sorted by age, staleness tiers, gone dropped', () => {
  const raw = loadFixture();
  raw.writers.push({ handle: 'old', device: '00000000', firstSeenAt: iso(-25 * 60), verified: 'yes', presence: { handle: 'old', device: '00000000', lastSeen: iso(-25 * 60) } });
  raw.writers.push({ handle: 'alice', device: 'a2a2a2a2', firstSeenAt: iso(-1), verified: 'yes', presence: { handle: 'alice', device: 'a2a2a2a2', branch: 'main', lastSeen: iso(-1) } });
  const snap = normalizeSnapshot(raw, NOW);
  const rows = activeWriters(snap, NOW, me);
  assert.deepEqual(rows.map((r) => [r.handle, r.tier]), [['alice', 'fresh'], ['dave', 'fresh'], ['bob', 'fresh'], ['carol', 'stale']]);
  assert.equal(rows[0].device, 'a2a2a2a2', 'my other device counts as a teammate');
  assert.ok(!rows.some((r) => r.handle === 'old'), 'over 24 h is gone');
  assert.equal(tierOf(6 * 60_000), 'recent');
  assert.equal(tierOf(NaN), 'gone');
  const w = snap.writers.find((x) => x.handle === 'bob');
  assert.equal(presenceAgeMs(w, NOW), 4 * 60_000, 'the older of firstSeenAt and lastSeen');
  assert.equal(activeWriters(null, NOW, me).length, 0);
  assert.deepEqual([...handlesActiveWithin(snap, NOW)].sort(), ['alice', 'bob', 'carol', 'dave', 'old'], 'a day-old writer still counts for the 30-day seats window');
});

test('relevantWriters: area covering an edited path or an active claim overlapping it', () => {
  const snap = normalizeSnapshot(loadFixture(), NOW);
  const rows = activeWriters(snap, NOW, me);
  assert.deepEqual(relevantWriters(rows, ['src/api/users.ts'], NOW).map((r) => r.handle), ['dave', 'bob']);
  assert.deepEqual(relevantWriters(rows, ['src/shared/x/y.ts'], NOW).map((r) => r.handle), ['bob'], 'directory claim covers a nested file');
  assert.deepEqual(relevantWriters(rows, ['docs/readme.md'], NOW), []);
  assert.deepEqual(relevantWriters(rows, [], NOW), []);
});

test('journal tail reader: appends with kick, tolerates torn lines, tail-reads large files, recentEdits window', async () => {
  const rig = await makeRig({ snapshot: null });
  assert.deepEqual(readJournalTail(rig.checkoutDir), [], 'no journal yet');
  assert.equal(appendJournal(rig.checkoutDir, { type: 'edit', path: 'src/a.ts' }, { sid: 's1', t: iso(-5) }), true);
  assert.equal(appendJournal(rig.checkoutDir, { nope: true }), false, 'events need a type');
  rig.journal(Array.from({ length: 5000 }, (_, i) => ({ t: iso(-60 * 24 * 2), sid: 's1', type: 'edit', path: `src/old${i}.ts` })));
  rig.journal([{ t: iso(-1), sid: 's2', type: 'edit', path: 'src/b.ts' }]);
  const events = readJournalTail(rig.checkoutDir, { maxBytes: 64 * 1024 });
  assert.ok(events.length > 100 && events.length < 5000, `tail read ${events.length} events`);
  assert.equal(events[events.length - 1].path, 'src/b.ts');
  const all = readJournalTail(rig.checkoutDir, { maxBytes: 10 * 1024 * 1024 });
  assert.equal(all[0].sid, 's1');
  const recent = recentEdits(all, NOW);
  assert.deepEqual([...recent.keys()], ['src/b.ts', 'src/a.ts'], 'newest first, two-day-old edits excluded');
  assert.deepEqual([...recentEdits(all, NOW, 24 * 3600 * 1000, { sid: 's2' }).keys()], ['src/b.ts']);
  assert.equal(repoRelativePath(rig.loc, rig.repo, 'C:\\other\\x.ts'), null, 'a foreign drive path is outside the work tree');
});
