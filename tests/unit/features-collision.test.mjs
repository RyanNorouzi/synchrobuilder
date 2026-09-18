import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { makeRig, loadFixture, iso, NOW } from './features-rig.mjs';
import { collision, findMatches } from '../../plugins/synchrobuilder/lib/features/collision.mjs';
import { normalizeSnapshot, repoRelativePath } from '../../plugins/synchrobuilder/lib/features/common.mjs';
import { LIMITS } from '../../plugins/synchrobuilder/lib/core/schema.mjs';

const ASK_CONFIG = { version: 1, collision: { mode: 'ask', windowMinutes: 30 } };

test('collision: warn on an exact claim with a fixed-template systemMessage and wrapped context', async () => {
  const rig = await makeRig();
  const out = await collision(rig.ctx(), { file_path: path.join(rig.repo, 'src', 'api', 'users.ts') });
  assert.ok(out, 'warning produced');
  assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(out.hookSpecificOutput.permissionDecision, undefined, 'warn mode never asks');
  assert.equal(out.systemMessage, 'Synchrobuilder: bob edited src/api/users.ts 5 min ago (branch feat/api) and 1 more');
  const ctxText = out.hookSpecificOutput.additionalContext;
  assert.ok(ctxText.includes('kind=collision'));
  assert.ok(ctxText.includes('from=bob kind=claim path=src/api/users.ts'));
  assert.ok(ctxText.includes('| adding pagination, please hold off'));
  assert.ok(!ctxText.includes('from=dave'), 'email-mismatch writer never reaches the collision surface');
  const body = ctxText.split('\n').filter((l) => l.startsWith('  @') || l.startsWith('  | ')).join('\n');
  assert.ok(body.length <= LIMITS.collisionChars, `body ${body.length}`);
  assert.ok(rig.readJson('warned.json')['src/api/users.ts'], 'throttle recorded');
  assert.equal(await collision(rig.ctx(), { file_path: path.join(rig.repo, 'src', 'api', 'users.ts') }), null, 'second warning inside the window is throttled');
  const later = await collision(rig.ctx({ now: NOW + 31 * 60_000 }), { file_path: path.join(rig.repo, 'src', 'api', 'users.ts') });
  assert.equal(later.systemMessage, 'Synchrobuilder: bob claimed src/api/users.ts 46 min ago (branch feat/api) as of 11:58Z', 'window expired: the 33 min old snapshot warns with an as-of stamp; the edit aged out, the claim did not');
});

test('collision: directory claims cover files below them; backslash and relative paths normalize; outside paths ignored', async () => {
  const rig = await makeRig();
  const out = await collision(rig.ctx(), { file_path: 'src\\shared\\types.ts' });
  assert.ok(out && out.systemMessage.startsWith('Synchrobuilder: bob claimed src/shared 10 min ago'));
  assert.equal(await collision(rig.ctx(), { file_path: path.join(rig.home, 'elsewhere.ts') }), null);
  assert.equal(await collision(rig.ctx(), { file_path: path.join(rig.repo, 'README.md') }), null, 'no claim, no warning');
  assert.equal(repoRelativePath(rig.loc, rig.repo, 'src/../src/api/users.ts'), 'src/api/users.ts');
  assert.equal(repoRelativePath(rig.loc, rig.repo, '../outside.ts'), null);
});

test('collision: ask mode asks only when fresh and permitted; degrades to warn otherwise', async () => {
  const fresh = await makeRig({ config: ASK_CONFIG });
  const ask = await collision(fresh.ctx({ permissionMode: 'default' }), { file_path: 'src/api/users.ts' });
  assert.equal(ask.hookSpecificOutput.permissionDecision, 'ask');
  assert.match(ask.hookSpecificOutput.permissionDecisionReason, /^Synchrobuilder: bob edited src\/api\/users\.ts 5 min ago \(branch feat\/api\)\. Editing src\/api\/users\.ts may collide with their work\.$/);
  for (const mode of ['dontAsk', 'bypassPermissions', 'plan']) {
    const r = await makeRig({ config: ASK_CONFIG });
    const out = await collision(r.ctx({ permissionMode: mode }), { file_path: 'src/api/users.ts' });
    assert.equal(out.hookSpecificOutput.permissionDecision, undefined, `${mode} downgrades to warn`);
  }
  const snap = loadFixture();
  snap.fetchedAt = iso(-8);
  const recent = await makeRig({ config: ASK_CONFIG, snapshot: snap });
  const warn = await collision(recent.ctx(), { file_path: 'src/api/users.ts' });
  assert.equal(warn.hookSpecificOutput.permissionDecision, undefined, '5-15 min old snapshot: ask becomes warn');
  assert.ok(!warn.systemMessage.includes('as of'));
  snap.fetchedAt = iso(-20);
  const stale = await makeRig({ config: ASK_CONFIG, snapshot: snap });
  const asOf = await collision(stale.ctx(), { file_path: 'src/api/users.ts' });
  assert.ok(asOf.systemMessage.endsWith(' as of 11:40Z'), asOf.systemMessage);
  snap.fetchedAt = iso(-25 * 60);
  const gone = await makeRig({ config: ASK_CONFIG, snapshot: snap });
  assert.equal(await collision(gone.ctx(), { file_path: 'src/api/users.ts' }), null, 'over 24 h: silent');
});

test('collision: null when muted, without identity, or without a snapshot; findMatches ignores expired claims', async () => {
  const rig = await makeRig();
  assert.equal(await collision(rig.ctx({ muted: true }), { file_path: 'src/api/users.ts' }), null);
  const noId = await makeRig({ identity: null });
  assert.equal(await collision(noId.ctx(), { file_path: 'src/api/users.ts' }), null);
  const noSnap = await makeRig({ snapshot: null });
  assert.equal(await collision(noSnap.ctx(), { file_path: 'src/api/users.ts' }), null);
  const snap = normalizeSnapshot(loadFixture(), NOW);
  const matches = findMatches(snap, { handle: 'alice', device: 'aaaaaaaa' }, 'src/api/users.ts', NOW + 5 * 3600 * 1000);
  assert.equal(matches.length, 0, 'claims expire after their ttl and edits after 30 min');
});
