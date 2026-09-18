// Replays recorded hook inputs through the real dispatcher: exit 0, valid or empty stdout, inside budget, no writes outside SYNCHROBUILDER_HOME.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const runner = path.join(repo, 'plugins', 'synchrobuilder', 'hooks', 'run.mjs');
const fixtures = path.join(repo, 'tests', 'fixtures', 'hook-inputs');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-home-'));
const cwd = repo; // a real git repository, so the hooks can locate a checkout

function replay(verb, input, extraEnv = {}) {
  const t0 = process.hrtime.bigint();
  const r = spawnSync(process.execPath, [runner, verb], { input: JSON.stringify({ ...input, cwd }), encoding: 'utf8', cwd, env: { ...process.env, SYNCHROBUILDER_HOME: home, ...extraEnv }, timeout: 10000 });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return { ...r, ms };
}

const timings = {};
for (const file of fs.readdirSync(fixtures).filter((f) => f.endsWith('.json'))) {
  const verb = file.replace(/\.json$/, '');
  test(`hook ${verb} replays with exit 0 and JSON-or-empty stdout`, () => {
    const input = JSON.parse(fs.readFileSync(path.join(fixtures, file), 'utf8'));
    const r = replay(verb, input);
    assert.equal(r.status, 0, `exit code ${r.status}, stderr: ${r.stderr}`);
    const out = (r.stdout || '').trim();
    if (out) { assert.ok(out.startsWith('{') && out.endsWith('}'), 'stdout must be a single JSON object'); JSON.parse(out); }
    timings[verb] = r.ms;
  });
}

test('hooks exit 0 on malformed stdin and unknown verbs', () => {
  const r1 = spawnSync(process.execPath, [runner, 'prompt'], { input: 'not json', encoding: 'utf8', cwd, env: { ...process.env, SYNCHROBUILDER_HOME: home } });
  assert.equal(r1.status, 0);
  assert.equal((r1.stdout || '').trim(), '');
  const r2 = spawnSync(process.execPath, [runner, 'bogus'], { input: '{}', encoding: 'utf8', cwd, env: { ...process.env, SYNCHROBUILDER_HOME: home } });
  assert.equal(r2.status, 0);
  assert.equal((r2.stdout || '').trim(), '');
});

test('hooks work outside a git repository', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-nogit-'));
  const r = spawnSync(process.execPath, [runner, 'session-start'], { input: JSON.stringify({ session_id: 'x', cwd: tmp, hook_event_name: 'SessionStart', source: 'startup' }), encoding: 'utf8', cwd: tmp, env: { ...process.env, SYNCHROBUILDER_HOME: home } });
  assert.equal(r.status, 0);
});

test('session-start records the session under SYNCHROBUILDER_HOME only', () => {
  const dirs = fs.readdirSync(path.join(home, 'checkouts'));
  assert.ok(dirs.length >= 1, 'a checkout directory was created');
  const sessions = fs.readdirSync(path.join(home, 'checkouts', dirs[0], 'sessions'));
  assert.ok(sessions.length >= 1, 'a session file was written');
  assert.ok(!fs.existsSync(path.join(repo, '.git', 'synchrobuilder')), 'nothing written inside the repository .git');
});

test('report timings (informational)', () => {
  const rows = Object.entries(timings).map(([k, v]) => `${k}=${v.toFixed(0)}ms`).join(' ');
  console.log(`hook end-to-end timings on ${process.platform} node ${process.version}: ${rows}`);
  for (const [verb, ms] of Object.entries(timings)) assert.ok(ms < 2000, `${verb} took ${ms} ms`);
});
