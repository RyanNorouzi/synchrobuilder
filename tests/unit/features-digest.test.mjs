import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRig, loadFixture, NOW, iso } from './features-rig.mjs';
import { digest } from '../../plugins/synchrobuilder/lib/features/digest.mjs';
import { LIMITS } from '../../plugins/synchrobuilder/lib/core/schema.mjs';

function block(text) {
  const begin = text.match(/=== synchrobuilder:begin teammate-data nonce=([0-9a-f]{16}) kind=digest ===/);
  assert.ok(begin, 'begin marker');
  assert.ok(text.includes(`=== synchrobuilder:end teammate-data nonce=${begin[1]} ===`), 'end marker with the same nonce');
  const inner = text.split('\n').slice(text.split('\n').findIndex((l) => l.startsWith('=== synchrobuilder:begin')) + 1);
  const body = inner.slice(0, inner.findIndex((l) => l.startsWith('=== synchrobuilder:end')));
  for (const l of body) assert.ok(l.startsWith('  @') || l.startsWith('  | '), `inner line is prefixed: ${JSON.stringify(l)}`);
  return body;
}

test('digest: sections in priority order, self excluded, teammate text sanitized, messages marked seen', async () => {
  const rig = await makeRig();
  rig.journal([{ t: iso(-20), sid: 's0', type: 'edit', path: 'src/shared/types.ts' }]);
  const text = await digest(rig.ctx());
  assert.ok(text, 'digest produced');
  const body = block(text);
  const kinds = body.filter((l) => l.startsWith('  @entry')).map((l) => l.match(/kind=([a-z-]+)/)[1]);
  assert.equal(kinds[0], 'claim', 'claims touching my recent paths come first');
  assert.ok(kinds.indexOf('message') < kinds.indexOf('handoff') && kinds.indexOf('handoff') < kinds.indexOf('presence') && kinds.indexOf('presence') < kinds.indexOf('board'), kinds.join(','));
  assert.ok(body.some((l) => l.includes('from=bob kind=claim') && l.includes('path=src/shared')), 'bob claims src/shared, which covers my edited file');
  assert.ok(!body.some((l) => l.includes('from=alice')), 'my own writer entry is excluded');
  assert.ok(body.some((l) => l.includes('from=dave kind=presence') && l.includes('verified=email-mismatch')), 'unverified writer shows in presence with its label');
  assert.ok(!body.some((l) => l.includes('from=dave kind=message')), 'unverified writer never reaches the message section');
  assert.ok(text.includes('&lt;script&gt;'), 'task summary is HTML-escaped by the sanitizer');
  assert.ok(!text.includes('<script>'));
  assert.ok(body.some((l) => l.includes('from=bob kind=message to=me')), 'message for me');
  assert.ok(body.some((l) => l.includes('kind=handoff') && l.includes('for=everyone')), 'handoff for everyone');
  assert.ok(body.some((l) => l.includes('kind=board id=client-paging-3c4d') && l.includes('blocked=api-pagination-1a2b')));
  assert.ok(text.length <= LIMITS.digestChars);
  const seen = rig.readJson('seen.json');
  assert.ok(seen.messages['01K5G000000000000000000M01'], 'bob message marked seen');
  assert.ok(seen.handoffs['01K5G000000000000000000H01'], 'handoff marked seen');
  const again = await digest(rig.ctx());
  const body2 = block(again);
  assert.ok(!body2.some((l) => l.includes('kind=message')), 'seen messages are not repeated');
  assert.ok(!body2.some((l) => l.includes('kind=handoff')), 'seen handoffs are not repeated');
});

test('digest: null when muted, without identity, without snapshot, or with nothing relevant', async () => {
  const rig = await makeRig();
  assert.equal(await digest(rig.ctx({ muted: true })), null);
  const noId = await makeRig({ identity: null });
  assert.equal(await digest(noId.ctx()), null);
  const noSnap = await makeRig({ snapshot: null });
  assert.equal(await digest(noSnap.ctx()), null);
  const empty = loadFixture();
  empty.writers = empty.writers.filter((w) => w.handle === 'alice');
  const lonely = await makeRig({ snapshot: empty });
  assert.equal(await digest(lonely.ctx()), null);
});

test('digest: over 24 h old, only the staleness note and durable sections remain', async () => {
  const snap = loadFixture();
  snap.fetchedAt = iso(-30 * 60);
  const rig = await makeRig({ snapshot: snap });
  const text = await digest(rig.ctx());
  const body = block(text);
  assert.ok(body[0].includes('kind=sync status=stale'));
  assert.ok(!body.some((l) => l.includes('kind=presence')), 'no presence when the snapshot is a day old');
  assert.ok(!body.some((l) => l.includes('kind=claim')));
  assert.ok(body.some((l) => l.includes('kind=message')), 'messages still delivered');
});

test('digest: 50 teammates and 500 claims stay under the 6000 character budget with @truncated', async () => {
  const snap = { schemaVersion: 1, fetchedAt: iso(-1), transport: {}, writers: [] };
  for (let i = 0; i < 50; i++) {
    const h = `dev${i}`;
    snap.writers.push({
      handle: h, device: (i + 100).toString(16).padStart(8, '0').slice(0, 8), sha: 'x', firstSeenAt: iso(-2), verified: 'yes',
      presence: { handle: h, device: (i + 100).toString(16).padStart(8, '0').slice(0, 8), branch: `feat/${h}`, task: `Working on thing number ${i} with a fairly long description of the work`, area: 'src', lastSeen: iso(-1) },
      claims: Array.from({ length: 10 }, (_, j) => ({ id: null, path: `src/mod${j}/file${i}.ts`, at: iso(-3), note: `note ${i}-${j} with some words in it` })),
      messages: [{ from: h, to: 'alice', at: iso(-4), text: `message from ${h} `.repeat(10) }], handoffs: [], board: [{ id: `task-${i}`, title: `Task ${i}`, status: 'open', deps: [], updatedAt: iso(-5) }], contracts: [],
    });
  }
  const rig = await makeRig({ snapshot: snap });
  rig.journal(Array.from({ length: 10 }, (_, j) => ({ t: iso(-10), sid: 's', type: 'edit', path: `src/mod${j}/file1.ts` })));
  const text = await digest(rig.ctx());
  assert.ok(text.length <= LIMITS.digestChars, `length ${text.length}`);
  const body = block(text);
  assert.ok(body.some((l) => l.includes('kind=truncated dropped=')), 'truncation recorded');
  assert.ok(body.some((l) => l.includes('kind=claim')), 'highest priority section survives');
});

test('digest: ctx.snapshot (already parsed) is accepted and re-validated', async () => {
  const rig = await makeRig({ snapshot: null });
  const raw = loadFixture();
  raw.writers[1].presence.branch = 'bad..branch';
  const text = await digest(rig.ctx({ snapshot: raw }));
  const bobPresence = text.split('\n').find((l) => l.includes('from=bob kind=presence'));
  assert.ok(bobPresence && bobPresence.includes('branch=(withheld)'), 'invalid branch is withheld, not rendered');
  assert.equal(typeof NOW, 'number');
});
