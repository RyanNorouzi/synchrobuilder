// Leases end to end (ADR-007): two developers with separate homes and separate clones, one real bare git remote,
// driven through the real hooks, CLI and worker. Nothing is faked: the lease refs are created by real pushes, and
// the race is two hook processes started at the same moment.
//
// What this proves that the unit tests cannot: that a git remote really does pick exactly one winner, that the
// loser's hook really does print a deny, and that letting go really does free the file for the other machine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const plugin = path.join(repo, 'plugins', 'synchrobuilder');
const cli = path.join(plugin, 'bin', 'synchrobuilder.mjs');
const hook = path.join(plugin, 'hooks', 'run.mjs');

const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'sb-lease-e2e-'));
const origin = path.join(root, 'origin.git');
const dev = (name) => ({ name, home: path.join(root, `home-${name}`), clone: path.join(root, `clone-${name}`) });
const alice = dev('alice');
const bob = dev('bob');

function sh(program, args, { cwd, env = {}, input } = {}) {
  const r = spawnSync(program, args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...env }, input, encoding: 'utf8', timeout: 60000, windowsHide: true });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), stdout: r.stdout || '' };
}
const git = (cwd, ...args) => sh('git', args, { cwd });
const envOf = (d) => ({ SYNCHROBUILDER_HOME: d.home, SYNCHROBUILDER_NO_WORKER: '1' });
const run = (d, ...args) => sh(process.execPath, [cli, ...args], { cwd: d.clone, env: envOf(d) });
const hookInput = (d, input) => JSON.stringify({ session_id: `sid-${d.name}`, cwd: d.clone, ...input });
const hookRun = (d, verb, input = {}) => sh(process.execPath, [hook, verb], { cwd: d.clone, env: envOf(d), input: hookInput(d, input) });
const editInput = (d, rel) => ({ hook_event_name: 'PreToolUse', tool_name: 'Edit', permission_mode: 'default', tool_input: { file_path: path.join(d.clone, ...rel.split('/')), old_string: 'a', new_string: 'b' } });
const parse = (s) => { const t = (s || '').trim(); return t.startsWith('{') ? JSON.parse(t) : null; };
const decision = (r) => { const o = parse(r.stdout); return o && o.hookSpecificOutput ? o.hookSpecificOutput.permissionDecision || null : null; };
const reason = (r) => { const o = parse(r.stdout); return (o && o.hookSpecificOutput && o.hookSpecificOutput.permissionDecisionReason) || ''; };
const preEdit = (d, rel) => hookRun(d, 'pre-edit', editInput(d, rel));

/** The same pre-edit hook, started without waiting, so two of them can overlap. */
function preEditAsync(d, rel) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [hook, 'pre-edit'], { cwd: d.clone, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...envOf(d) }, windowsHide: true });
    let stdout = '';
    child.stdout.on('data', (c) => { stdout += c; });
    child.on('close', (code) => resolve({ code, stdout }));
    child.stdin.end(hookInput(d, editInput(d, rel)));
  });
}

let paths;
function locateAs(d) {
  const previous = process.env.SYNCHROBUILDER_HOME;
  process.env.SYNCHROBUILDER_HOME = d.home;
  try { return paths.locate(d.clone); } finally { if (previous === undefined) delete process.env.SYNCHROBUILDER_HOME; else process.env.SYNCHROBUILDER_HOME = previous; }
}
function workerOnce(d) { const loc = locateAs(d); return run(d, 'worker', loc.checkoutDir, loc.remoteDir, '--once', '--json'); }
function leaseRefs() { return git(origin, 'for-each-ref', '--format=%(refname)', 'refs/synchrobuilder/lease1').stdout.split(/\r?\n/).filter(Boolean); }
function holderOnRemote(ref) { const m = git(origin, 'log', '-1', '--format=%b', ref).stdout.match(/\{.*\}/); return m ? JSON.parse(m[0]) : null; }
/** A refusal is cached for 20 s so a retry costs nothing. The test is not waiting 20 s to check a release. */
function forgetRefusals(d) { try { fs.unlinkSync(path.join(locateAs(d).checkoutDir, 'lease-denied.json')); } catch { /* none */ } }

async function setup() {
  paths = await import('../../plugins/synchrobuilder/lib/core/paths.mjs');
  git(root, 'init', '-q', '--bare', origin);
  for (const d of [alice, bob]) {
    git(root, 'clone', '-q', origin, d.clone);
    git(d.clone, 'config', 'user.name', d.name);
    git(d.clone, 'config', 'user.email', `${d.name}@example.com`);
    fs.mkdirSync(d.home, { recursive: true });
  }
  fs.mkdirSync(path.join(alice.clone, 'src'), { recursive: true });
  fs.writeFileSync(path.join(alice.clone, 'src', 'app.js'), 'export const a = 1;\n');
  fs.mkdirSync(path.join(alice.clone, '.synchrobuilder'), { recursive: true });
  fs.writeFileSync(path.join(alice.clone, '.synchrobuilder', 'team.json'), JSON.stringify({ version: 1, members: { alice: { name: 'Alice', emails: ['alice@example.com'] }, bob: { name: 'Bob', emails: ['bob@example.com'] } } }, null, 2));
  git(alice.clone, 'add', '-A');
  git(alice.clone, 'commit', '-q', '-m', 'init');
  git(alice.clone, 'push', '-q', 'origin', 'HEAD:main');
  git(bob.clone, 'pull', '-q', 'origin', 'main');
}

test('leases end to end across two machines', async (t) => {
  await setup();

  await t.test('before anyone else has been seen, an edit takes no remote lease', () => {
    assert.equal(hookRun(alice, 'session-start', { hook_event_name: 'SessionStart', source: 'startup' }).code, 0);
    assert.equal(workerOnce(alice).code, 0);
    const r = preEdit(alice, 'src/solo.js');
    assert.equal(r.code, 0, r.out);
    assert.equal(decision(r), null);
    assert.deepEqual(leaseRefs(), [], 'a developer alone leaves nothing on the remote');
    assert.equal(run(alice, 'lease', 'release').code, 0);
  });

  await t.test('once each has seen the other, the first to edit a file holds it on the remote', () => {
    assert.equal(hookRun(bob, 'session-start', { hook_event_name: 'SessionStart', source: 'startup' }).code, 0);
    assert.equal(workerOnce(bob).code, 0);
    assert.equal(workerOnce(alice).code, 0);
    assert.equal(workerOnce(bob).code, 0);
    const r = preEdit(alice, 'src/app.js');
    assert.equal(r.code, 0, r.out);
    assert.equal(decision(r), null, r.stdout);
    const refs = leaseRefs();
    assert.equal(refs.length, 1, `expected one lease ref, got ${refs.join(',')}`);
    const doc = holderOnRemote(refs[0]);
    assert.deepEqual([doc.handle, doc.path], ['alice', 'src/app.js']);
  });

  await t.test('the other machine is refused that file, told why, and is free to work on anything else', () => {
    const refused = preEdit(bob, 'src/app.js');
    assert.equal(refused.code, 0, refused.out);
    assert.equal(decision(refused), 'deny', refused.stdout);
    assert.match(reason(refused), /alice's agent on another machine is editing src\/app\.js right now/);
    assert.equal(decision(preEdit(bob, 'src/app.js')), 'deny', 'and again, from the cache');
    const other = preEdit(bob, 'src/other.js');
    assert.equal(decision(other), null, other.stdout);
    assert.equal(leaseRefs().length, 2);
    assert.equal(decision(preEdit(alice, 'src/other.js')), 'deny', 'it works in both directions');
  });

  await t.test('status and lease show who holds what', () => {
    assert.equal(workerOnce(bob).code, 0);
    const status = JSON.parse(run(bob, 'status', '--json').stdout);
    const byPath = Object.fromEntries(status.leases.map((l) => [l.path, l]));
    assert.deepEqual([byPath['src/app.js'].handle, byPath['src/app.js'].where], ['alice', 'remote']);
    assert.equal(byPath['src/other.js'].where, 'you');
    const listed = run(bob, 'lease');
    assert.match(listed.out, /src\/app\.js\s+held by alice \(another machine\)/);
    assert.match(listed.out, /src\/other\.js\s+held by you/);
  });

  await t.test('two machines starting on the same new file at the same moment: exactly one gets it, every time', async () => {
    for (let round = 1; round <= 5; round++) {
      const rel = `src/race-${round}.js`;
      const [a, b] = await Promise.all([preEditAsync(alice, rel), preEditAsync(bob, rel)]);
      assert.equal(a.code, 0);
      assert.equal(b.code, 0);
      const denied = [a, b].filter((r) => decision(r) === 'deny').length;
      assert.equal(denied, 1, `round ${round}: expected exactly one refusal, got ${denied}\nalice: ${a.stdout}\nbob: ${b.stdout}`);
    }
    assert.equal(leaseRefs().length, 7, 'app.js, other.js and one per race');
  });

  await t.test('releasing a file frees it for the other machine after one sync', () => {
    forgetRefusals(bob);
    assert.equal(run(alice, 'release', 'src/app.js').code, 0);
    assert.equal(decision(preEdit(bob, 'src/app.js')), 'deny', 'not until alice has synced');
    forgetRefusals(bob);
    assert.equal(workerOnce(alice).code, 0);
    const r = preEdit(bob, 'src/app.js');
    assert.equal(decision(r), null, r.stdout);
    assert.equal(holderOnRemote(leaseRefs().find((ref) => holderOnRemote(ref).path === 'src/app.js')).handle, 'bob');
  });

  await t.test('ending a session lets go of everything it held', () => {
    // Who won each race above is a coin flip, so alice takes one file of her own to be sure she holds something.
    assert.equal(decision(preEdit(alice, 'src/alice-only.js')), null);
    const before = leaseRefs().map(holderOnRemote).filter((d) => d.handle === 'alice').length;
    assert.ok(before >= 1, 'alice holds at least the file she just took');
    assert.equal(hookRun(alice, 'session-end', { hook_event_name: 'SessionEnd', reason: 'exit' }).code, 0);
    assert.equal(workerOnce(alice).code, 0);
    assert.equal(leaseRefs().map(holderOnRemote).filter((d) => d.handle === 'alice').length, 0);
    forgetRefusals(bob);
    assert.equal(decision(preEdit(bob, 'src/alice-only.js')), null, 'and bob can take what she held');
  });

  await t.test('a person can take a held file over with --force, and the old holder is refused from then on', () => {
    assert.equal(hookRun(alice, 'session-start', { hook_event_name: 'SessionStart', source: 'startup' }).code, 0);
    const plain = run(alice, 'lease', 'take', 'src/other.js');
    assert.equal(plain.code, 1, plain.out);
    assert.match(plain.out, /held by bob on another machine/);
    const forced = run(alice, 'lease', 'take', 'src/other.js', '--force');
    assert.equal(forced.code, 0, forced.out);
    assert.equal(holderOnRemote(leaseRefs().find((ref) => holderOnRemote(ref).path === 'src/other.js')).handle, 'alice', forced.out);
    // Bob still believes he holds it until his worker tries to renew and finds the ref is no longer his.
    assert.equal(workerOnce(bob).code, 0);
    const r = preEdit(bob, 'src/other.js');
    assert.equal(decision(r), 'deny', r.stdout);
  });

  await t.test('two agents in two worktrees on one machine: the second is refused at once, with no sync in between', () => {
    const second = { name: 'alice-wt', home: alice.home, clone: path.join(root, 'clone-alice-wt') };
    assert.equal(git(alice.clone, 'worktree', 'add', '-q', '-b', 'wt', second.clone).code, 0);
    assert.equal(hookRun(second, 'session-start', { hook_event_name: 'SessionStart', source: 'startup' }).code, 0);
    assert.equal(workerOnce(alice).code, 0, 'one tick so the new seat has an identity');
    assert.equal(decision(preEdit(alice, 'src/local.js')), null);
    const refused = preEdit(second, 'src/local.js');
    assert.equal(decision(refused), 'deny', refused.stdout);
    assert.match(reason(refused), /another agent on this machine \(worktree clone-alice\) is editing src\/local\.js/);
    assert.equal(decision(preEdit(second, 'src/elsewhere.js')), null);
    assert.equal(decision(preEdit(alice, 'src/elsewhere.js')), 'deny');
    // Ending the first agent's session frees its files for the sibling immediately: no worker tick, no network.
    assert.equal(hookRun(alice, 'session-end', { hook_event_name: 'SessionEnd', reason: 'exit' }).code, 0);
    forgetRefusals(second);
    assert.equal(decision(preEdit(second, 'src/local.js')), null);
  });

  await t.test('leases.mode off takes nothing and refuses nothing', () => {
    fs.writeFileSync(path.join(bob.clone, '.synchrobuilder', 'config.json'), JSON.stringify({ version: 1, leases: { mode: 'off' } }));
    forgetRefusals(bob);
    const count = leaseRefs().length;
    assert.equal(decision(preEdit(bob, 'src/other.js')), null);
    assert.equal(decision(preEdit(bob, 'src/brand-new.js')), null);
    assert.equal(leaseRefs().length, count);
  });

  fs.rmSync(root, { recursive: true, force: true });
});
