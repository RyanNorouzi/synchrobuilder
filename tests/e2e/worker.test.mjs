// The real detached background worker, end to end: a session starts it, it publishes while the session runs,
// it survives the session ending, finishes a last tick, and then exits and releases its lock.
//
// This is the one path the other end-to-end test deliberately does not cover. That test sets
// SYNCHROBUILDER_NO_WORKER=1 and drives every sync itself with "worker --once", so nothing there proves the
// spawned worker works. docs/VERIFICATION.md named this gap and this file is what closes it.
//
// Ticks are driven by the kick file rather than the clock. Every hook already touches it (see session-end),
// and sleepUntilKick wakes on it, so the mechanism under test is the product's own, not a test shortcut.
// Without it the worker's floor of ten seconds plus up to fifteen seconds of jitter would make this minutes long.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pidAlive } from '../../plugins/synchrobuilder/lib/core/proc.mjs';

// fileURLToPath, not new URL().pathname: on Windows the latter yields "/C:/..." with a leading slash, which
// is not a path any fs call accepts, so the READY check below would silently skip this whole file.
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const cli = path.join(repo, 'plugins', 'synchrobuilder', 'bin', 'synchrobuilder.mjs');
const hook = path.join(repo, 'plugins', 'synchrobuilder', 'hooks', 'run.mjs');
const READY = fs.existsSync(cli) && fs.existsSync(hook);

const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'sb-worker-'));
const origin = path.join(root, 'origin.git');
const dev = (name) => ({ name, home: path.join(root, `home-${name}`), clone: path.join(root, `clone-${name}`) });
const alice = dev('alice');
const bob = dev('bob');
let paths;

function sh(program, args, { cwd, env = {}, input } = {}) {
  const r = spawnSync(program, args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...env }, input, encoding: 'utf8', timeout: 60000, windowsHide: true });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), stdout: r.stdout || '' };
}
const git = (cwd, ...args) => sh('git', args, { cwd });
const run = (d, ...args) => sh(process.execPath, [cli, ...args], { cwd: d.clone, env: { SYNCHROBUILDER_HOME: d.home } });
// No SYNCHROBUILDER_NO_WORKER here: letting session-start spawn the real worker is the whole point.
const hookRun = (d, verb, input) => sh(process.execPath, [hook, verb], {
  cwd: d.clone,
  env: { SYNCHROBUILDER_HOME: d.home },
  input: JSON.stringify({ session_id: `sid-${d.name}`, cwd: d.clone, ...input }),
});

function locateAs(d) {
  const previous = process.env.SYNCHROBUILDER_HOME;
  process.env.SYNCHROBUILDER_HOME = d.home;
  try { return paths.locate(d.clone); } finally { if (previous === undefined) delete process.env.SYNCHROBUILDER_HOME; else process.env.SYNCHROBUILDER_HOME = previous; }
}
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const statusOf = (d) => readJson(path.join(locateAs(d).remoteDir, 'status.json'));
const snapshotOf = (d) => readJson(path.join(locateAs(d).remoteDir, 'snapshot.json'));
const writersOf = (d) => { const s = snapshotOf(d); return s && Array.isArray(s.writers) ? s.writers : []; };
const lockDirOf = (d) => path.join(locateAs(d).remoteDir, 'worker.lock');
const kick = (d) => { const f = path.join(locateAs(d).checkoutDir, 'kick'); fs.writeFileSync(f, String(Date.now())); };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Poll until the predicate holds. Returns true, or false once the budget is spent. */
async function until(predicate, { timeoutMs = 25000, stepMs = 150 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let ok = false;
    try { ok = !!predicate(); } catch { ok = false; }
    if (ok) return true;
    if (Date.now() > deadline) return false;
    await sleep(stepMs);
  }
}
/** The ref this developer publishes, read straight from the bare origin. */
function remoteRefs() {
  const r = git(root, 'ls-remote', origin, 'refs/synchrobuilder/*');
  return (r.stdout || '').trim().split('\n').filter(Boolean);
}

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
  fs.writeFileSync(path.join(alice.clone, 'src', 'api.ts'), 'export type Order = { id: string };\n');
  fs.mkdirSync(path.join(alice.clone, '.synchrobuilder'), { recursive: true });
  fs.writeFileSync(path.join(alice.clone, '.synchrobuilder', 'team.json'), JSON.stringify({
    version: 1,
    members: { alice: { name: 'Alice', emails: ['alice@example.com'] }, bob: { name: 'Bob', emails: ['bob@example.com'] } },
  }, null, 2));
  git(alice.clone, 'add', '-A');
  git(alice.clone, 'commit', '-q', '-m', 'init');
  git(alice.clone, 'push', '-q', 'origin', 'HEAD:main');
  git(bob.clone, 'pull', '-q', 'origin', 'main');
}

/** Stop any worker still running, so a failed assertion cannot leave a process behind. */
function reap() {
  for (const d of [alice, bob]) {
    const pid = (statusOf(d) || {}).workerPid;
    if (pid && pidAlive(pid)) { try { process.kill(pid); } catch { /* already gone */ } }
  }
}

test('the detached worker runs, outlives the session, and exits cleanly', { skip: !READY && 'plugin not built' }, async (t) => {
  await setup();
  let alicePid = null;

  try {
    await t.test('session-start spawns a real worker that takes the lock', async () => {
      assert.equal(run(alice, 'iam', 'alice').code, 0);
      const r = hookRun(alice, 'session-start', { hook_event_name: 'SessionStart', source: 'startup' });
      assert.equal(r.code, 0, r.out);

      const started = await until(() => {
        const s = statusOf(alice);
        return s && Number.isInteger(s.workerPid) && pidAlive(s.workerPid);
      });
      assert.ok(started, `no live worker appeared; status: ${JSON.stringify(statusOf(alice))}`);
      alicePid = statusOf(alice).workerPid;
      assert.notEqual(alicePid, process.pid, 'the worker is its own process, not this one');
      assert.ok(fs.existsSync(lockDirOf(alice)), 'the worker holds the remote lock');
    });

    await t.test('it publishes to the real remote while the session is open', async () => {
      assert.equal(run(alice, 'claim', 'src/api.ts').code, 0);
      const published = await until(() => {
        kick(alice);
        return remoteRefs().some((l) => /refs\/synchrobuilder\/v1\/alice\//.test(l));
      });
      assert.ok(published, `alice's ref never reached the origin; refs: ${remoteRefs().join(' | ')}`);
    });

    await t.test('a second worker refuses to start beside the first', async () => {
      // The regression this guards: runWorker negated the result object instead of its .ok field, so the
      // guard never fired and two workers raced to publish one writer's ref.
      const loc = locateAs(alice);
      const second = run(alice, 'worker', loc.checkoutDir, loc.remoteDir, '--json');
      assert.match(second.out, /another worker holds the lock/, `expected a refusal, got: ${second.out}`);
      assert.equal(statusOf(alice).workerPid, alicePid, 'the original worker still owns the remote');
      assert.ok(pidAlive(alicePid), 'and it is still running');
    });

    await t.test("the other developer's worker picks the claim up", async () => {
      assert.equal(run(bob, 'iam', 'bob').code, 0);
      assert.equal(hookRun(bob, 'session-start', { hook_event_name: 'SessionStart', source: 'startup' }).code, 0);
      // Both ends are kicked each poll: alice has to publish it before bob can pull it, and in a real session
      // every hook kicks constantly, so this is the ordinary cadence rather than a test shortcut.
      const sawAlice = await until(() => {
        kick(alice); kick(bob);
        return writersOf(bob).some((w) => w.handle === 'alice' && (w.claims || []).some((c) => c.path === 'src/api.ts'));
      }, { timeoutMs: 40000, stepMs: 300 });
      assert.ok(sawAlice, `bob never saw the claim; writers: ${JSON.stringify(writersOf(bob))}`);
    });

    await t.test('the session ends, and the worker finishes a last tick before exiting', async () => {
      assert.equal(run(alice, 'claim', 'src/final.ts').code, 0);
      // session-end marks the session closed and touches the kick file itself; nothing else prompts the worker.
      assert.equal(hookRun(alice, 'session-end', { hook_event_name: 'SessionEnd', reason: 'clear' }).code, 0);

      // Two consecutive idle ticks end the loop. The worker publishes on the way out, so its exit is also the
      // proof that it finished a last tick after the session that spawned it had gone.
      const exited = await until(() => { kick(alice); return !pidAlive(alicePid); }, { timeoutMs: 60000, stepMs: 300 });
      assert.ok(exited, `the worker is still alive (pid ${alicePid}) long after its last session closed`);
      assert.equal(fs.existsSync(lockDirOf(alice)), false, 'it released the lock on the way out');
    });

    await t.test("bob receives alice's final claim, made moments before she closed", async () => {
      kick(bob);
      const sawFinal = await until(() => writersOf(bob).some((w) => w.handle === 'alice' && (w.claims || []).some((c) => c.path === 'src/final.ts')), { timeoutMs: 30000 });
      assert.ok(sawFinal, `the final claim never arrived; writers: ${JSON.stringify(writersOf(bob))}`);
    });

    await t.test('neither repository was written to', () => {
      for (const d of [alice, bob]) {
        assert.ok(!fs.existsSync(path.join(d.clone, '.git', 'synchrobuilder')));
        assert.equal(git(d.clone, 'status', '--porcelain').stdout.trim(), '', `${d.name} worktree stays clean`);
        assert.ok(!/synchrobuilder/.test(git(d.clone, 'branch', '--list').stdout), 'no local branches created');
      }
    });
  } finally {
    hookRun(bob, 'session-end', { hook_event_name: 'SessionEnd', reason: 'clear' });
    await until(() => { kick(bob); const s = statusOf(bob); return !s || !s.workerPid || !pidAlive(s.workerPid); }, { timeoutMs: 40000, stepMs: 400 });
    reap();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
