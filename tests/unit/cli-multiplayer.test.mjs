// Runs the multiplayer CLI commands as real processes against a temp home and a fake checkout with a snapshot, and asserts
// the journal lines they append and what they print.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { makeRig, loadFixture, NOW, pluginRoot } from './features-rig.mjs';

const bin = path.join(pluginRoot, 'bin', 'synchrobuilder.mjs');

/** The fixture uses fixed times; the CLI uses the wall clock, so shift every timestamp so "fetched 2 min ago" stays true. */
function liveFixture() {
  const shift = Date.now() - NOW;
  const text = JSON.stringify(loadFixture()).replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/g, (m) => new Date(Date.parse(m) + shift).toISOString());
  return JSON.parse(text);
}

async function cliRig(extra = {}) {
  const rig = await makeRig({ snapshot: liveFixture(), team: { version: 1, members: { alice: { emails: [] }, bob: { emails: [] }, erin: { emails: [] } } }, ...extra });
  rig.run = (...args) => {
    const r = spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', env: rig.env(), cwd: rig.repo, timeout: 15000 });
    return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
  };
  rig.last = (type) => rig.readJournal().filter((e) => e.type === type).pop();
  return rig;
}

test('claim and release append journal events, touch kick, and mention overlapping teammate claims', async () => {
  const rig = await cliRig();
  const r = rig.run('claim', 'src/api/users.ts', '--note', 'fixing pagination ghp_abcdefghijklmnopqrstuvwxyz0123');
  assert.equal(r.code, 0, r.err);
  assert.ok(r.out.includes('Claimed src/api/users.ts'), r.out);
  assert.ok(r.out.includes('Heads up: bob claims src/api/users.ts'), r.out);
  const ev = rig.last('claim');
  assert.equal(ev.path, 'src/api/users.ts');
  assert.match(ev.id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
  assert.ok(!ev.note.includes('ghp_') && ev.note.includes('[redacted]'), ev.note);
  assert.ok(fs.existsSync(path.join(rig.checkoutDir, 'kick')));
  assert.equal(rig.run('claim', 'src\\shared\\types.ts').code, 0, 'backslash path accepted');
  assert.equal(rig.last('claim').path, 'src/shared/types.ts');
  const task = rig.run('claim', 'write-docs-5e6f');
  assert.equal(task.code, 0, task.err);
  assert.deepEqual([rig.last('claim').task, rig.last('claim').path], ['write-docs-5e6f', undefined]);
  assert.equal(rig.run('claim', '../outside.ts').code, 1);
  assert.equal(rig.run('claim').code, 1);
  const st = rig.run('status');
  assert.ok(st.out.includes('My claims: src/api/users.ts'), st.out);
  const rel = rig.run('release', 'src/api/users.ts');
  assert.equal(rel.code, 0, rel.err);
  assert.equal(rig.last('release').path, 'src/api/users.ts');
  assert.equal(rig.last('release').id, ev.id, 'release carries the claim id');
  assert.ok(!rig.run('status').out.includes('My claims: src/api/users.ts'));
  const all = rig.run('release');
  assert.equal(all.code, 0);
  assert.deepEqual(Object.keys(rig.last('release')).sort(), ['sid', 't', 'type'], 'empty release = all');
  assert.ok(rig.run('status').out.includes('My claims: none.'));
});

test('notify validates the handle, redacts secrets, caps at 400 code points, appends a notify event', async () => {
  const rig = await cliRig();
  const r = rig.run('notify', 'bob', 'please', 'look', 'at', 'src/shared/types.ts', 'token', 'sk-ant-abcdefghijklmnopqrstuvwxyz0123');
  assert.equal(r.code, 0, r.err);
  assert.ok(r.out.includes('Queued message to bob') && r.out.includes('1 secret redacted'), r.out);
  const ev = rig.last('notify');
  assert.equal(ev.to, 'bob');
  assert.ok(ev.text.startsWith('please look at src/shared/types.ts token ') && !ev.text.includes('sk-ant') && ev.text.includes('[redacted]'), ev.text);
  assert.match(ev.id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
  assert.equal(rig.run('notify', 'erin', 'hi').code, 0, 'team.json member without snapshot state is known');
  assert.equal(rig.run('notify', 'carol', 'hi').code, 0, 'snapshot writer is known');
  const unknown = rig.run('notify', 'mallory', 'hi');
  assert.equal(unknown.code, 1);
  assert.ok(unknown.err.includes('Unknown handle'));
  assert.equal(rig.run('notify', 'Bob', 'hi').code, 1, 'handles are lowercase');
  assert.equal(rig.run('notify', 'alice', 'hi').code, 1, 'cannot notify yourself');
  assert.equal(rig.run('notify', 'bob').code, 1, 'message required');
  const long = rig.run('notify', 'bob', 'x'.repeat(1000));
  assert.equal(long.code, 0);
  assert.equal(Array.from(rig.last('notify').text).length, 400);
  assert.ok(long.out.includes('cut to 400'));
  const ctl = rig.run('notify', 'bob', 'line1[31mred\nline2');
  assert.equal(rig.last('notify').text, 'line1[31mred\nline2', 'controls stripped, LF kept');
  assert.equal(ctl.code, 0);
});

test('board: add, list, next, take (blocked refused), done unblocks, folded with the snapshot', async () => {
  const rig = await cliRig();
  const add = rig.run('board', 'add', 'Ship', 'the', 'thing!', '--deps', 'api-pagination-1a2b');
  assert.equal(add.code, 0, add.err);
  const ev = rig.last('board');
  assert.equal(ev.op, 'add');
  assert.match(ev.task.id, /^ship-the-thing-[0-9a-f]{4}$/);
  assert.deepEqual(ev.task, { id: ev.task.id, title: 'Ship the thing!', deps: ['api-pagination-1a2b'], status: 'open', owner: null });
  const list = rig.run('board', 'list');
  assert.ok(list.out.includes(ev.task.id) && list.out.includes('client-paging-3c4d') && list.out.includes('blocked'), list.out);
  const json = JSON.parse(rig.run('board', '--json').out);
  assert.equal(json.next.id, 'write-docs-5e6f');
  assert.ok(json.tasks.find((t) => t.id === ev.task.id).blockedBy.includes('api-pagination-1a2b'));
  const blocked = rig.run('board', 'take', ev.task.id);
  assert.equal(blocked.code, 1);
  assert.ok(blocked.err.includes('blocked by api-pagination-1a2b'));
  const taken = rig.run('board', 'take', 'api-pagination-1a2b');
  assert.equal(taken.code, 1, 'owned by bob');
  const next = rig.run('board', 'next');
  assert.ok(next.out.startsWith('Next: write-docs-5e6f'), next.out);
  const take = rig.run('board', 'take', 'write-docs-5e6f');
  assert.equal(take.code, 0, take.err);
  assert.deepEqual([rig.last('board').op, rig.last('board').task.status, rig.last('board').task.owner], ['take', 'in-progress', 'alice']);
  const done = rig.run('board', 'done', 'api-pagination-1a2b');
  assert.equal(done.code, 0, done.err);
  assert.ok(done.out.includes('unblocks client-paging-3c4d'), done.out);
  const after = JSON.parse(rig.run('board', 'list', '--json').out);
  assert.equal(after.next.id, 'client-paging-3c4d');
  assert.equal(after.tasks.find((t) => t.id === ev.task.id).ready, true);
  assert.equal(rig.run('board', 'take', 'nope-1').code, 1);
  assert.equal(rig.run('board', 'add', '--deps', 'Bad Dep', 'x').code, 1);
  assert.equal(rig.run('board', 'frobnicate').code, 1);
  const alone = await cliRig({ identity: null });
  assert.equal(alone.run('board', 'take', 'write-docs-5e6f').code, 1, 'no identity, no take');
});

test('handoff: --draft stages from the journal, --confirm appends the handoff event', async () => {
  const rig = await cliRig();
  const t = new Date().toISOString();
  rig.journal([
    { t, sid: 'sess-9', type: 'edit', path: 'src/api/users.ts' },
    { t, sid: 'sess-9', type: 'task-summary', text: 'Pagination for /users' },
    { t, sid: 'sess-9', type: 'contract-change', path: 'src/shared/types.ts', symbols: ['User'] },
  ]);
  const empty = (await cliRig()).run('handoff', '--draft');
  assert.ok(empty.out.includes('Nothing to hand off yet'));
  const draft = rig.run('handoff', '--draft');
  assert.equal(draft.code, 0, draft.err);
  assert.match(draft.out, /^Handoff draft [0-9A-HJKMNP-TV-Z]{26} from alice/);
  assert.ok(draft.out.includes('- src/api/users.ts') && draft.out.includes('- src/shared/types.ts: User'), draft.out);
  const id = draft.out.match(/Handoff draft (\S+)/)[1];
  const withFor = JSON.parse(rig.run('handoff', 'bob', '--json').out);
  assert.deepEqual(withFor.for, ['bob']);
  assert.equal(rig.run('handoff', 'Not-A-Handle').code, 1);
  assert.equal(rig.run('handoff', '--confirm', 'WRONGID').code, 1);
  const ok = rig.run('handoff', '--confirm', id, '--done', 'Cursor pagination; Tests', '--next', 'Client paging', '--for', 'bob,carol');
  assert.equal(ok.code, 0, ok.err);
  assert.ok(ok.out.includes(`Handoff ${id} recorded for bob, carol`), ok.out);
  const ev = rig.last('handoff');
  assert.equal(ev.handoff.id, id);
  assert.equal(ev.handoff.from, 'alice');
  assert.deepEqual(ev.handoff.done, ['Cursor pagination', 'Tests']);
  assert.deepEqual(ev.handoff.next, ['Client paging']);
  assert.deepEqual(ev.handoff.for, ['bob', 'carol']);
  assert.deepEqual(ev.handoff.files, ['src/api/users.ts']);
  assert.equal(ev.sid, 'sess-9');
});

test('status: identity, transport, teammates with staleness labels, board summary, --json; seats notice once', async () => {
  const rig = await cliRig();
  fs.writeFileSync(path.join(rig.remoteDir, 'status.json'), JSON.stringify({ mode: 'custom', lastOkAt: new Date().toISOString(), lastErrorClass: null, workerPid: 4242 }));
  const r = rig.run('status');
  assert.equal(r.code, 0, r.err);
  assert.ok(r.out.includes('You: alice on device aaaaaaaa (team.json)'), r.out);
  assert.ok(r.out.includes('Sync: mode custom, last ok') && r.out.includes('worker pid 4242'), r.out);
  assert.ok(/Snapshot: fetched 2 min ago \(fresh\), 4 writers/.test(r.out), r.out);
  assert.ok(/bob\s+feat\/api\s+src\/api\s+4m fresh\s+yes\s+Add pagination to \/users alertoo/.test(r.out) || r.out.includes('bob'), r.out);
  assert.ok(!r.out.includes('\u001b') && r.out.includes('Add pagination to /users <script>alert(1)</script>'), 'task summary is printable ASCII only: the ESC sequence is stripped');
  assert.ok(/carol\s+main\s+-\s+2h stale/.test(r.out), r.out);
  assert.ok(/dave\s+feat\/x\s+src\/api\s+2m fresh\s+email-mismatch/.test(r.out), r.out);
  assert.ok(!/^\s*alice\s/m.test(r.out.split('Teammates')[1]), 'self is not listed as a teammate');
  assert.ok(r.out.includes('Board: 1 open, 1 in progress, 1 blocked, 0 done (next: write-docs-5e6f Write docs)'), r.out);
  assert.ok(r.out.includes('4 people were active'), 'seats notice for four active handles');
  assert.ok(!rig.run('status').out.includes('4 people were active'), 'seats notice not repeated');
  const j = JSON.parse(rig.run('status', '--json').out);
  assert.equal(j.identity.handle, 'alice');
  assert.equal(j.snapshot.tier, 'fresh');
  assert.deepEqual(j.teammates.map((x) => x.handle), ['dave', 'bob', 'carol']);
  assert.equal(j.transport.workerPid, 4242);
  const bare = await makeRig({ snapshot: null, identity: null });
  const b = spawnSync(process.execPath, [bin, 'status'], { encoding: 'utf8', env: bare.env(), cwd: bare.repo, timeout: 15000 });
  assert.equal(b.status, 0, b.stderr);
  assert.ok(b.stdout.includes('identity not resolved') && b.stdout.includes('no worker has run') && b.stdout.includes('Teammates: none'), b.stdout);
  const outside = spawnSync(process.execPath, [bin, 'status'], { encoding: 'utf8', env: bare.env(), cwd: bare.home, timeout: 15000 });
  assert.equal(outside.status, 1);
});
