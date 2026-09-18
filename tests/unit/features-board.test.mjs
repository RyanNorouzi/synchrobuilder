import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFixture, NOW, iso } from './features-rig.mjs';
import { foldBoard, nextTask, makeTaskId, summarizeBoard } from '../../plugins/synchrobuilder/lib/features/board-fold.mjs';
import { normalizeSnapshot } from '../../plugins/synchrobuilder/lib/features/common.mjs';
import { isTaskId } from '../../plugins/synchrobuilder/lib/core/schema.mjs';

test('foldBoard: dependencies block, next picks the first ready task, journal events override the snapshot', () => {
  const snap = normalizeSnapshot(loadFixture(), NOW);
  const tasks = foldBoard(snap, [], NOW);
  const byId = Object.fromEntries(tasks.map((t) => [t.id, t]));
  assert.deepEqual(byId['client-paging-3c4d'].blockedBy, ['api-pagination-1a2b']);
  assert.equal(byId['client-paging-3c4d'].ready, false);
  assert.equal(nextTask(tasks).id, 'write-docs-5e6f');
  assert.deepEqual(summarizeBoard(tasks), { open: 1, 'in-progress': 1, blocked: 1, done: 0 });
  const journal = [
    { t: iso(-1), sid: 's', type: 'board', op: 'done', task: { id: 'api-pagination-1a2b', title: 'API pagination', deps: [], status: 'done', owner: 'bob' } },
    { t: iso(-1), sid: 's', type: 'board', op: 'add', task: { id: 'new-task-0001', title: 'New task', deps: ['missing-dep'], status: 'open', owner: null } },
    { t: iso(-60), sid: 's', type: 'board', op: 'take', task: { id: 'write-docs-5e6f', title: 'Write docs', deps: [], status: 'in-progress', owner: 'alice' } },
  ];
  const folded = foldBoard(snap, journal, NOW);
  const f = Object.fromEntries(folded.map((t) => [t.id, t]));
  assert.equal(f['api-pagination-1a2b'].status, 'done', 'newer journal event wins');
  assert.equal(f['client-paging-3c4d'].ready, true, 'completing the dependency unblocks the dependent');
  assert.deepEqual(f['new-task-0001'].missingDeps, ['missing-dep']);
  assert.equal(f['new-task-0001'].ready, false, 'unknown dependencies keep a task blocked');
  assert.equal(f['write-docs-5e6f'].status, 'open', 'an older journal event does not override a newer snapshot entry');
  assert.equal(nextTask(folded).id, 'client-paging-3c4d');
});

test('foldBoard ignores invalid journal tasks and tolerates an empty snapshot', () => {
  const tasks = foldBoard(null, [{ t: iso(0), type: 'board', op: 'add', task: { id: 'Bad Id', title: 'x' } }, { t: iso(0), type: 'board', op: 'add', task: { id: 'ok-1', title: 'ok', deps: ['ok-1', 'other'], status: 'weird' } }], NOW);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].status, 'open');
  assert.deepEqual(tasks[0].deps, ['other'], 'self-dependency dropped by the validator');
});

test('makeTaskId: slug plus 4 hex, always a valid task id', () => {
  assert.equal(makeTaskId('Add pagination to /users!', 'ab12'), 'add-pagination-to-users-ab12');
  assert.ok(isTaskId(makeTaskId('   ', 'ffff')));
  assert.equal(makeTaskId('   ', 'ffff'), 'task-ffff');
  const long = makeTaskId('a'.repeat(100), '1234');
  assert.ok(isTaskId(long) && long.length <= 40 && long.endsWith('-1234'));
  assert.equal(makeTaskId('Ünïcode títle', '0000'), 'unicode-title-0000');
  assert.ok(isTaskId(makeTaskId('Refactor')));
});
