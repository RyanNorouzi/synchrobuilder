import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeRig, loadFixture, NOW } from './features-rig.mjs';
import { contractAlert, teammatesInArea, topLevelArea } from '../../plugins/synchrobuilder/lib/features/contracts.mjs';
import { extractSymbols } from '../../plugins/synchrobuilder/lib/features/symbols.mjs';
import { normalizeSnapshot } from '../../plugins/synchrobuilder/lib/features/common.mjs';
import { LIMITS } from '../../plugins/synchrobuilder/lib/core/schema.mjs';

test('extractSymbols: exported names per format, validated and capped', () => {
  const ts = `export function foo() {}\nexport const bar = 1;\nexport default class Baz {}\nexport type Q = 1;\nexport interface I {}\nexport enum E {}\nexport { a as b, type c, default };\nconst hidden = 2;\nexport async function* gen() {}\nexport declare namespace NS {}`;
  assert.deepEqual(extractSymbols('src/types/x.ts', ts), ['foo', 'bar', 'Baz', 'Q', 'I', 'E', 'gen', 'NS', 'b', 'c']);
  assert.deepEqual(extractSymbols('prisma/schema.prisma', 'model User {\n id Int\n}\nenum Role { A }\ntype Address {}\n'), ['User', 'Role', 'Address']);
  assert.deepEqual(extractSymbols('api/schema.graphql', 'type Query { a: Int }\nextend type User { b: Int }\ninput NewUser { n: String }\nscalar Date\n'), ['Query', 'User', 'NewUser', 'Date']);
  assert.deepEqual(extractSymbols('proto/api.proto', 'syntax = "proto3";\nmessage Ping {}\nservice Api {}\nenum Kind {}\n'), ['Ping', 'Api', 'Kind']);
  assert.deepEqual(extractSymbols('contracts/user.schema.json', JSON.stringify({ $schema: 'x', title: 'User', properties: { id: {}, name: {} }, 'bad key': 1 })), ['$schema', 'title', 'properties', 'id', 'name']);
  assert.deepEqual(extractSymbols('openapi.yaml', 'openapi: 3.0.0\n# comment\ninfo:\n  title: x\nproperties:\n  id: {}\n  name: {}\n'), ['openapi', 'info', 'properties', 'id', 'name']);
  assert.deepEqual(extractSymbols('README.md', '# nope'), []);
  assert.deepEqual(extractSymbols('x.json', '{not json'), []);
  const many = Array.from({ length: 40 }, (_, i) => `export const s${i} = ${i};`).join('\n');
  assert.equal(extractSymbols('a.mjs', many).length, 20);
});

test('teammatesInArea and topLevelArea', () => {
  const snap = normalizeSnapshot(loadFixture(), NOW);
  assert.equal(topLevelArea('src/shared/types.ts'), 'src');
  assert.equal(topLevelArea('schema.prisma'), '');
  const rows = teammatesInArea(snap, { handle: 'alice', device: 'aaaaaaaa' }, 'src', NOW);
  const bob = rows.find((r) => r.handle === 'bob');
  assert.ok(bob && bob.reasons.some((r) => r.startsWith('claims src/api/users.ts')) && bob.reasons.includes('area src/api'), JSON.stringify(rows));
  assert.ok(rows.find((r) => r.handle === 'dave').verified === 'email-mismatch');
  assert.ok(!rows.find((r) => r.handle === 'alice'), 'self excluded');
  assert.equal(teammatesInArea(snap, { handle: 'alice', device: 'aaaaaaaa' }, 'docs', NOW).length, 0);
});

test('contractAlert: journal event with symbols, note naming teammates in the area, null for non-contract paths', async () => {
  const rig = await makeRig();
  fs.mkdirSync(path.join(rig.repo, 'src', 'contracts'), { recursive: true });
  const file = path.join(rig.repo, 'src', 'contracts', 'api.ts');
  fs.writeFileSync(file, 'export interface User { id: string }\nexport function list() {}\n');
  const note = await contractAlert(rig.ctx(), { file_path: file });
  assert.ok(note, 'note produced');
  assert.ok(note.startsWith('Synchrobuilder: src/contracts/api.ts is a contract file (now exports User, list).'), note);
  assert.ok(note.includes('bob (branch feat/api)') && note.includes('dave') && note.includes('[verified=email-mismatch]'), note);
  assert.ok(!note.includes('alice'), 'self is not listed');
  assert.ok(note.length <= LIMITS.alertChars);
  const ev = rig.readJournal().find((e) => e.type === 'contract-change');
  assert.deepEqual([ev.path, ev.symbols, ev.sid], ['src/contracts/api.ts', ['User', 'list'], 'sess-1']);
  assert.ok(fs.existsSync(path.join(rig.checkoutDir, 'kick')));
  assert.equal(await contractAlert(rig.ctx(), { file_path: path.join(rig.repo, 'src', 'api', 'users.ts') }), null, 'not a contract path');
  assert.equal(rig.readJournal().filter((e) => e.type === 'contract-change').length, 1, 'no journal event for non-contract paths');
  assert.equal(await contractAlert(rig.ctx({ muted: true }), { file_path: file }), null);
  assert.equal(await contractAlert(rig.ctx(), { file_path: path.join(rig.home, 'x', 'contracts', 'y.ts') }), null, 'outside the work tree');
});

test('contractAlert: custom config paths, and journal event even when no teammate is in the area', async () => {
  const rig = await makeRig({ config: { version: 1, contracts: { paths: ['api/**/*.proto'] } } });
  fs.mkdirSync(path.join(rig.repo, 'api', 'v1'), { recursive: true });
  const file = path.join(rig.repo, 'api', 'v1', 'svc.proto');
  fs.writeFileSync(file, 'message Ping {}\n');
  assert.equal(await contractAlert(rig.ctx(), { file_path: file }), null, 'nobody works under api/');
  const ev = rig.readJournal().find((e) => e.type === 'contract-change');
  assert.deepEqual([ev.path, ev.symbols], ['api/v1/svc.proto', ['Ping']]);
  const noSnap = await makeRig({ snapshot: null, config: { version: 1, contracts: { paths: ['api/**'] } } });
  fs.mkdirSync(path.join(noSnap.repo, 'api'), { recursive: true });
  fs.writeFileSync(path.join(noSnap.repo, 'api', 'x.json'), '{"a":1}');
  assert.equal(await contractAlert(noSnap.ctx(), { file_path: 'api/x.json' }), null);
  assert.equal(noSnap.readJournal().length, 1, 'the event is recorded for the worker even without a snapshot');
});
