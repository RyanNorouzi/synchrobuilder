import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRig, iso, NOW } from './features-rig.mjs';
import { stageHandoff, finalizeHandoff, draftFromEvents } from '../../plugins/synchrobuilder/lib/features/handoff.mjs';
import { extractFromMessage, describeEdits } from '../../plugins/synchrobuilder/lib/features/handoff-text.mjs';

const MESSAGE = `I moved the refresh logic.

Decision: keep cursor pagination
- **Blocked:** waiting on @bob for the schema
Next: wire the client

## Next steps
- Add tests for the middleware
- Ask @carol about release timing

**Blockers**
1. CI is red on windows

Unrelated paragraph mentioning ghp_abcdefghijklmnopqrstuvwxyz123456 should be redacted.
- this bullet is not under a heading`;

test('extractFromMessage: labelled lines, bullets under headings, mentions, redaction, caps', () => {
  const r = extractFromMessage(MESSAGE);
  assert.deepEqual(r.decisions, ['keep cursor pagination']);
  assert.deepEqual(r.blockers, ['waiting on @bob for the schema', 'CI is red on windows']);
  assert.deepEqual(r.next, ['wire the client', 'Add tests for the middleware', 'Ask @carol about release timing']);
  assert.deepEqual(r.for, ['bob', 'carol']);
  assert.ok(!JSON.stringify(r).includes('ghp_'), 'nothing outside labelled lines is kept');
  const long = extractFromMessage('Next: ' + 'y'.repeat(500));
  assert.ok(Array.from(long.next[0]).length <= 140);
  assert.deepEqual(extractFromMessage(''), { decisions: [], blockers: [], next: [], for: [] });
});

test('describeEdits groups by directory, largest first', () => {
  const lines = describeEdits(['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/e.ts', 'docs/x.md', 'README.md']);
  assert.equal(lines[0], 'Edited 5 files under src/ (a.ts, b.ts, c.ts, d.ts, ...)');
  assert.equal(lines[1], 'Edited 1 file under docs/ (x.md)');
  assert.equal(lines[2], 'Edited 1 file under ./ (README.md)');
});

test('stageHandoff builds the draft from this session only, keeps its id across stops, never stores the message', async () => {
  const rig = await makeRig();
  rig.journal([
    { t: iso(-50), sid: 'other', type: 'edit', path: 'src/other.ts' },
    { t: iso(-40), sid: 'sess-1', type: 'edit', path: 'src/api/users.ts' },
    { t: iso(-39), sid: 'sess-1', type: 'edit', path: 'src/api/users.ts' },
    { t: iso(-38), sid: 'sess-1', type: 'edit', path: 'src/shared/types.ts' },
    { t: iso(-30), sid: 'sess-1', type: 'task-summary', text: 'Cursor pagination for /users with @bob' },
    { t: iso(-20), sid: 'sess-1', type: 'contract-change', path: 'src/shared/types.ts', symbols: ['User', 'Page'] },
  ]);
  const draft = await stageHandoff(rig.ctx(), { last_assistant_message: MESSAGE });
  assert.ok(draft);
  assert.equal(draft.from, 'alice');
  assert.equal(draft.task, 'Cursor pagination for /users with @bob');
  assert.deepEqual(draft.files, ['src/api/users.ts', 'src/shared/types.ts']);
  assert.ok(!draft.files.includes('src/other.ts'), 'other sessions are excluded');
  assert.deepEqual(draft.interfaces, ['src/shared/types.ts: User, Page']);
  assert.ok(draft.done.includes('Edited 1 file under src/shared/ (types.ts)'));
  assert.deepEqual(draft.for, ['bob', 'carol']);
  assert.deepEqual(draft.decisions, ['keep cursor pagination']);
  const onDisk = rig.readJson('handoff-draft.json');
  assert.equal(onDisk.id, draft.id);
  assert.ok(!JSON.stringify(onDisk).includes('Unrelated paragraph'), 'the assistant message itself is not stored');
  const again = await stageHandoff(rig.ctx({ now: NOW + 60_000 }), { last_assistant_message: 'Next: ship it' });
  assert.equal(again.id, draft.id, 'same session keeps the draft id');
  assert.deepEqual(again.next, ['ship it']);
});

test('stageHandoff returns null with no events; finalizeHandoff appends a validated handoff event', async () => {
  const rig = await makeRig();
  assert.equal(await stageHandoff(rig.ctx(), {}), null);
  rig.journal([{ t: iso(-5), sid: 'sess-1', type: 'edit', path: 'src/api/users.ts' }]);
  const draft = await stageHandoff(rig.ctx(), { last_assistant_message: 'Blocked: nothing really' });
  const bad = finalizeHandoff(rig.checkoutDir, {}, { draftId: 'nope', now: NOW });
  assert.equal(bad.ok, false);
  const r = finalizeHandoff(rig.checkoutDir, { done: ['Finished pagination'], next: ['Client work'], for: ['bob', 'Not-Valid'], files: ['src/api/users.ts', '../evil'] }, { draftId: draft.id, now: NOW });
  assert.ok(r.ok, r.error);
  assert.equal(r.handoff.from, 'alice');
  assert.deepEqual(r.handoff.for, ['bob'], 'invalid handles are dropped by the validator');
  assert.deepEqual(r.handoff.files, ['src/api/users.ts']);
  assert.deepEqual(r.handoff.done, ['Finished pagination']);
  const events = rig.readJournal();
  const ev = events.find((e) => e.type === 'handoff');
  assert.ok(ev && ev.handoff.id === draft.id && ev.sid === 'sess-1');
  assert.ok(rig.readJson('handoff-draft.json').finalizedAt);
  assert.equal(draftFromEvents([], '', '').files.length, 0);
});
