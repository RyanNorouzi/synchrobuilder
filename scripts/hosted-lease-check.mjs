// Hosted lease check (ADR-007): the flow of tests/e2e/leases.test.mjs against a real hosted remote, with timings.
// Usage: node scripts/hosted-lease-check.mjs <repo root> <remote url>
// Use a private throwaway repository you can push to. It publishes state for two handles, h-alice and h-bob,
// takes and releases leases, and deletes every ref it created before it exits.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const [repo, url] = process.argv.slice(2);
const plugin = path.join(repo, 'plugins', 'synchrobuilder');
const cli = path.join(plugin, 'bin', 'synchrobuilder.mjs');
const hook = path.join(plugin, 'hooks', 'run.mjs');
const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'sb-hosted-'));
const dev = (name) => ({ name, home: path.join(root, `home-${name}`), clone: path.join(root, `clone-${name}`) });
const alice = dev('h-alice');
const bob = dev('h-bob');
const results = [];
const note = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  ${extra}` : ''}`); };

function sh(program, args, { cwd, env = {}, input } = {}) {
  const t = Date.now();
  const r = spawnSync(program, args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...env }, input, encoding: 'utf8', timeout: 120000, windowsHide: true });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), stdout: r.stdout || '', ms: Date.now() - t };
}
const git = (cwd, ...args) => sh('git', args, { cwd });
const envOf = (d) => ({ SYNCHROBUILDER_HOME: d.home, SYNCHROBUILDER_NO_WORKER: '1' });
const run = (d, ...args) => sh(process.execPath, [cli, ...args], { cwd: d.clone, env: envOf(d) });
const hookInput = (d, input) => JSON.stringify({ session_id: `sid-${d.name}`, cwd: d.clone, ...input });
const hookRun = (d, verb, input = {}) => sh(process.execPath, [hook, verb], { cwd: d.clone, env: envOf(d), input: hookInput(d, input) });
const editInput = (d, rel) => ({ hook_event_name: 'PreToolUse', tool_name: 'Edit', permission_mode: 'default', tool_input: { file_path: path.join(d.clone, ...rel.split('/')), old_string: 'a', new_string: 'b' } });
const parse = (s) => { const t = (s || '').trim(); return t.startsWith('{') ? JSON.parse(t) : null; };
const decision = (r) => { const o = parse(r.stdout); return o && o.hookSpecificOutput ? o.hookSpecificOutput.permissionDecision || null : null; };
const preEdit = (d, rel) => hookRun(d, 'pre-edit', editInput(d, rel));
function preEditAsync(d, rel) {
  return new Promise((resolve) => {
    const t = Date.now();
    const child = spawn(process.execPath, [hook, 'pre-edit'], { cwd: d.clone, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...envOf(d) }, windowsHide: true });
    let stdout = '';
    child.stdout.on('data', (c) => { stdout += c; });
    child.on('close', (code) => resolve({ code, stdout, ms: Date.now() - t }));
    child.stdin.end(hookInput(d, editInput(d, rel)));
  });
}
const paths = await import(pathToFileURL(path.join(plugin, 'lib', 'core', 'paths.mjs')).href);
function locateAs(d) {
  const previous = process.env.SYNCHROBUILDER_HOME;
  process.env.SYNCHROBUILDER_HOME = d.home;
  try { return paths.locate(d.clone); } finally { if (previous === undefined) delete process.env.SYNCHROBUILDER_HOME; else process.env.SYNCHROBUILDER_HOME = previous; }
}
const workerOnce = (d) => { const loc = locateAs(d); return run(d, 'worker', loc.checkoutDir, loc.remoteDir, '--once', '--json'); };
const leaseRefs = () => git(root, 'ls-remote', url, 'refs/synchrobuilder/lease1/*').stdout.split(/\r?\n/).filter(Boolean).map((l) => l.split(/\s+/)[1]);
const forget = (d) => { try { fs.unlinkSync(path.join(locateAs(d).checkoutDir, 'lease-denied.json')); } catch { /* none */ } };
const stamp = Date.now().toString(36);
const f = (n) => `src/hosted-${stamp}-${n}.js`;

try {
  for (const d of [alice, bob]) {
    const c = git(root, 'clone', '-q', url, d.clone);
    if (c.code !== 0) throw new Error(`clone failed: ${c.out}`);
    git(d.clone, 'config', 'user.name', d.name);
    git(d.clone, 'config', 'user.email', `${d.name}@example.com`);
    fs.mkdirSync(d.home, { recursive: true });
    hookRun(d, 'session-start', { hook_event_name: 'SessionStart', source: 'startup' });
    run(d, 'iam', d.name);
  }
  for (const d of [alice, bob, alice, bob]) { const w = workerOnce(d); if (w.code !== 0) throw new Error(`worker failed: ${w.out}`); }
  const st = JSON.parse(run(alice, 'status', '--json').stdout);
  note('both developers see each other over GitHub', st.teammates.some((t) => t.handle === 'h-bob'), `transport mode ${st.transport && st.transport.mode}, publishHeld ${st.transport && st.transport.publishHeld}`);

  const first = preEdit(alice, f(1));
  note('first edit takes a lease on GitHub inside the hook budget', first.code === 0 && decision(first) === null && leaseRefs().length === 1, `${first.ms} ms`);
  const again = preEdit(alice, f(1));
  note('a second edit to the same file is local only', decision(again) === null, `${again.ms} ms`);
  const refused = preEdit(bob, f(1));
  note('the other machine is refused', decision(refused) === 'deny', `${refused.ms} ms`);
  const cached = preEdit(bob, f(1));
  note('a repeated refusal comes from the cache', decision(cached) === 'deny', `${cached.ms} ms`);

  let exact = 0;
  const times = [];
  for (let i = 0; i < 4; i++) {
    const [a, b] = await Promise.all([preEditAsync(alice, f(`race${i}`)), preEditAsync(bob, f(`race${i}`))]);
    const denied = [a, b].filter((r) => decision(r) === 'deny').length;
    if (denied === 1) exact += 1;
    times.push(`${a.ms}/${b.ms}`);
  }
  note('simultaneous first edits: exactly one winner in every round', exact === 4, `${exact}/4 rounds, hook ms (alice/bob): ${times.join(' ')}`);

  run(alice, 'release', f(1));
  workerOnce(alice);
  forget(bob);
  const freed = preEdit(bob, f(1));
  note('a released file is free for the other machine after one sync', decision(freed) === null, `${freed.ms} ms`);
} catch (err) {
  note(`run aborted: ${err.message}`, false);
} finally {
  for (const d of [alice, bob]) { try { hookRun(d, 'session-end', { hook_event_name: 'SessionEnd', reason: 'exit' }); workerOnce(d); } catch { /* cleanup */ } }
  const left = leaseRefs();
  note('ending both sessions leaves no lease refs behind', left.length === 0, `${left.length} left`);
  const mine = git(root, 'ls-remote', url, 'refs/synchrobuilder/v1/h-alice/*', 'refs/synchrobuilder/v1/h-bob/*').stdout.split(/\r?\n/).filter(Boolean).map((l) => l.split(/\s+/)[1]);
  const junk = [...left, ...mine];
  if (junk.length) git(root, 'push', '-q', url, ...junk.map((r) => `:${r}`));
  console.log(`cleanup: removed ${junk.length} test refs`);
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* temp */ }
}
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
