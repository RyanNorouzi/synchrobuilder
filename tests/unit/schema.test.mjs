import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validRepoPath, validBranch, validTimestamp, validClaims, validMessage, isHandle, ulid } from '../../plugins/synchrobuilder/lib/core/schema.mjs';

test('repo paths: accept relative forward-slash paths, reject everything hostile', () => {
  assert.equal(validRepoPath('src/auth.ts'), 'src/auth.ts');
  for (const bad of ['../x', 'src/../src/a', '/etc/passwd', 'C:\\x', 'src\\a.ts', '.git/hooks/pre-commit', 'con.txt', 'a/nul/b', 'src/a\u200b.ts', 'src/\u202ea.ts', '', 'a//b', 'a/./b']) assert.equal(validRepoPath(bad), null, bad);
});

test('branches and handles', () => {
  assert.equal(validBranch('feat/x-1'), 'feat/x-1');
  for (const bad of ['-x', 'a..b', 'a//b', 'x/', 'x.lock', 'feat/x\n<system>', 'a'.repeat(200)]) assert.equal(validBranch(bad), null, bad);
  assert.ok(isHandle('alice-2'));
  for (const bad of ['Alice', '-a', 'a b', 'алиса', 'a'.repeat(33)]) assert.ok(!isHandle(bad), bad);
});

test('timestamps are clamped to plausible ranges', () => {
  const now = Date.parse('2026-09-18T12:00:00Z');
  assert.equal(validTimestamp('2026-09-18T11:00:00Z', now), '2026-09-18T11:00:00.000Z');
  assert.equal(validTimestamp('2099-01-01T00:00:00Z', now), null);
  assert.equal(validTimestamp('2019-01-01T00:00:00Z', now), null);
  assert.equal(validTimestamp('yesterday', now), null);
});

test('claims and messages are capped and typed', () => {
  const claims = validClaims(Array.from({ length: 500 }, (_, i) => ({ path: `src/f${i}.ts`, at: 'bogus' })));
  assert.equal(claims.length, 50);
  assert.equal(claims[0].timeUnverified, true);
  assert.equal(validMessage({ from: 'alice', to: 'bob', text: 'hi', at: 'x' }).text, 'hi');
  assert.equal(validMessage({ from: 'Alice', to: 'bob', text: 'hi' }), null);
  assert.equal(validClaims({ __proto__: { length: 1 } }).length, 0);
});

test('ulid is 26 chars and sortable by time', () => {
  const a = ulid(1000), b = ulid(2000);
  assert.equal(a.length, 26);
  assert.ok(a.slice(0, 10) < b.slice(0, 10));
});
