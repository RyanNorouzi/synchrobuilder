import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { makeRig, loadFixture, iso, NOW, pluginRoot } from './features-rig.mjs';
import { renderLine } from '../../plugins/synchrobuilder/lib/statusline/render.mjs';
import { plannedChange, RENDERER } from '../../plugins/synchrobuilder/lib/cli/statusline.mjs';

const renderer = path.join(pluginRoot, 'lib', 'statusline', 'render.mjs');
const bin = path.join(pluginRoot, 'bin', 'synchrobuilder.mjs');

test('renderLine: identity, teammates with staleness, sync state, validated identifiers only', async () => {
  const rig = await makeRig();
  fs.mkdirSync(path.join(rig.checkoutDir, 'own'), { recursive: true });
  fs.writeFileSync(path.join(rig.checkoutDir, 'own', 'presence.json'), JSON.stringify({ branch: 'feat/auth' }));
  fs.writeFileSync(path.join(rig.remoteDir, 'status.json'), JSON.stringify({ mode: 'custom', lastOkAt: iso(-2), lastErrorClass: null }));
  const line = renderLine({ cwd: rig.repo, now: NOW });
  assert.equal(line, 'sb ● alice feat/auth · dave feat/x (2m) · bob feat/api (4m) · carol main (2h) · sync ok 11:58Z');
  assert.ok(!line.includes('<') && !/[^\x20-\x7e●·]/.test(line), 'ASCII plus the two symbols');
  fs.writeFileSync(path.join(rig.remoteDir, 'status.json'), JSON.stringify({ mode: 'custom', lastOkAt: iso(-2), lastErrorClass: 'auth' }));
  assert.ok(renderLine({ cwd: rig.repo, now: NOW }).endsWith('sync auth 11:58Z'));
  const stale = loadFixture();
  stale.fetchedAt = iso(-26 * 60);
  rig.writeSnapshot(stale);
  assert.ok(renderLine({ cwd: rig.repo, now: NOW }).endsWith('sync stale 1d'));
  const bare = await makeRig({ snapshot: null, identity: null });
  assert.equal(renderLine({ cwd: bare.repo, now: NOW }), 'sb ● no identity · no teammates · sync off');
  assert.equal(renderLine({ cwd: os.tmpdir(), now: NOW }), 'sb', 'outside a repository');
});

test('render.mjs as a process: reads stdin JSON, prints one line, exits 0, fast', async () => {
  const rig = await makeRig({ snapshot: { schemaVersion: 1, fetchedAt: new Date().toISOString(), transport: {}, writers: [] } }); // real clock: the fixture's fixed times would be rejected as future or gone
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [renderer], { input: JSON.stringify({ workspace: { current_dir: rig.repo }, cwd: rig.repo }), encoding: 'utf8', env: rig.env(), timeout: 5000 });
  const ms = Date.now() - t0;
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^sb ● alice · .* · sync ok \d\d:\d\dZ\n$/);
  assert.equal(r.stdout.split('\n').length, 2, 'exactly one line');
  const junk = spawnSync(process.execPath, [renderer], { input: 'not json', encoding: 'utf8', env: rig.env(), cwd: os.tmpdir(), timeout: 5000 });
  assert.equal(junk.status, 0);
  assert.equal(junk.stdout, 'sb\n');
  console.log(`statusline render took ${ms} ms (target: under 300 ms; recorded, asserted loosely)`);
  assert.ok(ms < 3000);
});

test('statusline CLI: --plan prints the exact change; install needs --yes and keeps a backup; remove restores', async () => {
  const rig = await makeRig();
  const cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-claude-'));
  const settings = path.join(cfgDir, 'settings.json');
  fs.writeFileSync(settings, JSON.stringify({ theme: 'dark', statusLine: { type: 'command', command: 'echo mine' } }));
  const env = rig.env({ CLAUDE_CONFIG_DIR: cfgDir });
  const run = (...args) => spawnSync(process.execPath, [bin, 'statusline', ...args], { encoding: 'utf8', env, cwd: rig.repo, timeout: 10000 });
  const expected = { statusLine: { type: 'command', command: `node ${RENDERER.replace(/\\/g, '/')}`, refreshInterval: 20 } };
  assert.deepEqual(plannedChange(), expected);
  assert.ok(!expected.statusLine.command.includes('\\'), 'forward slashes');
  const plan = run('--plan');
  assert.equal(plan.status, 0);
  assert.ok(plan.stdout.includes(JSON.stringify(expected, null, 2)), plan.stdout);
  assert.ok(plan.stdout.includes('echo mine'), 'shows what will be replaced');
  assert.deepEqual(JSON.parse(fs.readFileSync(settings, 'utf8')).statusLine.command, 'echo mine', 'plan writes nothing');
  const dry = run('install');
  assert.equal(dry.status, 1, 'install without --yes refuses');
  assert.equal(JSON.parse(fs.readFileSync(settings, 'utf8')).statusLine.command, 'echo mine');
  const inst = run('install', '--yes');
  assert.equal(inst.status, 0, inst.stderr);
  const after = JSON.parse(fs.readFileSync(settings, 'utf8'));
  assert.deepEqual(after.statusLine, expected.statusLine);
  assert.equal(after.theme, 'dark', 'other settings kept');
  assert.ok(fs.existsSync(`${settings}.synchrobuilder-backup`));
  fs.writeFileSync(settings, JSON.stringify({ ...after, theme: 'light' }));
  assert.equal(run('remove').status, 1, 'remove without --yes refuses');
  const rm = run('remove', '--yes');
  assert.equal(rm.status, 0, rm.stderr);
  const restored = JSON.parse(fs.readFileSync(settings, 'utf8'));
  assert.equal(restored.statusLine.command, 'echo mine', 'previous status line restored');
  assert.equal(restored.theme, 'light', 'settings changed after install survive the removal');
  assert.ok(!fs.existsSync(`${settings}.synchrobuilder-backup`));
  const rm2 = run('remove', '--yes');
  assert.equal(rm2.status, 0);
  assert.ok(rm2.stdout.includes('Nothing to remove'));
});

test('statusline CLI: installing when no settings file exists creates it without a backup, and quotes paths with spaces', async () => {
  const rig = await makeRig();
  const cfgDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-claude-')), 'nested');
  const env = rig.env({ CLAUDE_CONFIG_DIR: cfgDir });
  const r = spawnSync(process.execPath, [bin, 'statusline', 'install', '--yes'], { encoding: 'utf8', env, cwd: rig.repo, timeout: 10000 });
  assert.equal(r.status, 0, r.stderr);
  const s = JSON.parse(fs.readFileSync(path.join(cfgDir, 'settings.json'), 'utf8'));
  assert.equal(s.statusLine.refreshInterval, 20);
  assert.ok(!fs.existsSync(path.join(cfgDir, 'settings.json.synchrobuilder-backup')));
  assert.equal(plannedChange('C:\\Users\\Some One\\render.mjs').statusLine.command, 'node "C:/Users/Some One/render.mjs"');
});
