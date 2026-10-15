// Two agents, two worktrees of one clone, one machine, one git identity.
//
// This is the configuration the whole seat change exists for, and the one that used to be invisible: both
// worktrees hashed to one state directory and one writer ref, and the self check matched them as the same
// person, so every teammate surface was empty.
//
// Nothing here runs a worker between a claim and the check. That is deliberate: the same-machine path reads
// a sibling's journal off the disk they share, so coordination must not depend on a sync interval.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const cli = path.join(repo, 'plugins', 'synchrobuilder', 'bin', 'synchrobuilder.mjs');
const hook = path.join(repo, 'plugins', 'synchrobuilder', 'hooks', 'run.mjs');
const READY = fs.existsSync(cli) && fs.existsSync(hook);

const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'sb-wta-'));
const origin = path.join(root, 'origin.git');
const home = path.join(root, 'home');          // one machine
const main = path.join(root, 'main');
const A = path.join(root, 'wt-a');
const B = path.join(root, 'wt-b');
let locA = null;
let locB = null;

function sh(program, args, { cwd, env = {}, input } = {}) {
  const r = spawnSync(program, args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...env }, input, encoding: 'utf8', timeout: 60000, windowsHide: true });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), stdout: r.stdout || '' };
}
const git = (cwd, ...args) => sh('git', args, { cwd });
const run = (cwd, ...args) => sh(process.execPath, [cli, ...args], { cwd, env: { SYNCHROBUILDER_HOME: home } });
const hookRun = (cwd, verb, input, sid) => sh(process.execPath, [hook, verb], {
  cwd, env: { SYNCHROBUILDER_HOME: home, SYNCHROBUILDER_NO_WORKER: '1' },
  input: JSON.stringify({ session_id: sid, cwd, ...input }),
});
const preEdit = (cwd, sid, rel) => hookRun(cwd, 'pre-edit', {
  hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: path.join(cwd, rel) },
}, sid);
const parse = (r) => { const t = (r.stdout || '').trim(); return t.startsWith('{') ? JSON.parse(t) : null; };
const writeConfig = (collision) => {
  for (const wt of [A, B]) {
    fs.mkdirSync(path.join(wt, '.synchrobuilder'), { recursive: true });
    fs.writeFileSync(path.join(wt, '.synchrobuilder', 'config.json'), JSON.stringify({ version: 1, collision }));
  }
};

test('two agents in two worktrees of one clone', { skip: !READY && 'plugin not built' }, async (t) => {
  git(root, 'init', '-q', '--bare', origin);
  git(root, 'clone', '-q', origin, main);
  git(main, 'config', 'user.name', 'alice');
  git(main, 'config', 'user.email', 'alice@example.com');
  fs.mkdirSync(path.join(main, 'src'), { recursive: true });
  fs.writeFileSync(path.join(main, 'src', 'api.ts'), 'export const x = 1;\n');
  fs.writeFileSync(path.join(main, 'src', 'other.ts'), 'export const y = 2;\n');
  git(main, 'add', '-A');
  git(main, 'commit', '-q', '-m', 'init');
  git(main, 'push', '-q', 'origin', 'HEAD:main');
  git(main, 'worktree', 'add', '-q', A, '-b', 'agent-a');
  git(main, 'worktree', 'add', '-q', B, '-b', 'agent-b');
  fs.mkdirSync(home, { recursive: true });

  process.env.SYNCHROBUILDER_HOME = home;
  const paths = await import('../../plugins/synchrobuilder/lib/core/paths.mjs');
  locA = paths.locate(A);
  locB = paths.locate(B);

  await t.test('the two worktrees are two seats sharing one remote', () => {
    assert.notEqual(locA.seat, locB.seat, 'distinct seats');
    assert.notEqual(locA.checkoutDir, locB.checkoutDir, 'distinct state directories');
    assert.equal(locA.remoteDir, locB.remoteDir, 'one remote, so one snapshot and one worker');
    assert.equal(locA.commonDir, locB.commonDir, 'and still one clone underneath');
  });

  await t.test('both register, and each publishes its own ref', () => {
    assert.equal(hookRun(A, 'session-start', { hook_event_name: 'SessionStart', source: 'startup' }, 'sid-a').code, 0);
    assert.equal(hookRun(B, 'session-start', { hook_event_name: 'SessionStart', source: 'startup' }, 'sid-b').code, 0);
    for (const loc of [locA, locB]) {
      assert.equal(run(main, 'worker', loc.checkoutDir, loc.remoteDir, '--once', '--json').code, 0);
    }
    const refs = git(root, 'ls-remote', origin, 'refs/synchrobuilder/*').stdout.trim().split('\n').filter(Boolean);
    assert.equal(refs.length, 2, `one ref per seat, got:\n${refs.join('\n')}`);
    assert.ok(refs.some((l) => l.includes(`/${locA.seat}`)), "agent A's seat is published");
    assert.ok(refs.some((l) => l.includes(`/${locB.seat}`)), "agent B's seat is published");
  });

  await t.test('a claim reaches the other agent with no sync in between', () => {
    assert.equal(run(A, 'claim', 'src/api.ts').code, 0);
    // No worker call here on purpose: this must work off the shared filesystem alone.
    const out = parse(preEdit(B, 'sid-b', 'src/api.ts'));
    assert.ok(out, 'agent B was warned');
    assert.match(out.systemMessage, /another agent here/, `expected a local-agent warning, got: ${out.systemMessage}`);
    assert.match(out.systemMessage, /agent-a/, 'and it names the branch the holder is on');
    assert.match(out.hookSpecificOutput.additionalContext, /synchrobuilder:begin teammate-data/, 'still wrapped as data');
  });

  await t.test('an unrelated file is not warned about', () => {
    assert.equal((preEdit(B, 'sid-b', 'src/other.ts').stdout || '').trim(), '', 'no warning for a file nobody holds');
  });

  await t.test('warn mode never refuses the edit', () => {
    writeConfig({ mode: 'warn', windowMinutes: 30, siblingWindowMinutes: 0 });
    const out = parse(preEdit(B, 'sid-b', 'src/api.ts'));
    assert.ok(out, 'still warned');
    assert.ok(!('permissionDecision' in out.hookSpecificOutput), 'warn mode stays advisory');
  });

  await t.test('block mode refuses a file a live sibling is holding, and says how it clears', () => {
    writeConfig({ mode: 'block', windowMinutes: 30, siblingWindowMinutes: 0 });
    const out = parse(preEdit(B, 'sid-b', 'src/api.ts'));
    assert.ok(out, 'produced a decision');
    assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
    const why = out.hookSpecificOutput.permissionDecisionReason;
    assert.match(why, /another agent on this machine is holding src\/api\.ts/);
    assert.match(why, /synchrobuilder release src\/api\.ts/, 'names the real command that lifts it');
    assert.match(why, /synchrobuilder status/, 'and the real command that shows who is on what');
  });

  await t.test('releasing the claim lifts the block immediately', () => {
    assert.equal(run(A, 'release', 'src/api.ts').code, 0);
    assert.equal((preEdit(B, 'sid-b', 'src/api.ts').stdout || '').trim(), '', 'nothing held, nothing said');
  });

  await t.test('a sibling whose session has ended warns but never blocks', () => {
    assert.equal(run(A, 'claim', 'src/api.ts').code, 0);
    assert.equal(hookRun(A, 'session-end', { hook_event_name: 'SessionEnd', reason: 'clear' }, 'sid-a').code, 0);
    const out = parse(preEdit(B, 'sid-b', 'src/api.ts'));
    assert.ok(out, 'the stale claim is still worth mentioning');
    assert.ok(!('permissionDecision' in out.hookSpecificOutput),
      'a finished agent must not be able to block a running one, or a crashed session would wedge the tree');
  });

  await t.test('neither worktree was written to', () => {
    for (const wt of [A, B]) {
      const dirty = git(wt, 'status', '--porcelain').stdout.split('\n').filter((l) => l.trim() && !l.includes('.synchrobuilder'));
      assert.deepEqual(dirty, [], `${wt} has no unexpected changes`);
    }
  });

  fs.rmSync(root, { recursive: true, force: true });
});
