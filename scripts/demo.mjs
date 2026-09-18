#!/usr/bin/env node
// Sets up two fake developers (alice and bob) on this machine, sharing one local bare git remote that contains the
// demo repository, and prints a two-terminal walkthrough. Node only; nothing is installed and nothing touches ~/.claude.
//   node scripts/demo.mjs [--dir <folder>] [--reset]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const plugin = path.join(repo, 'plugins', 'synchrobuilder');
const args = process.argv.slice(2);
const dirFlag = args.indexOf('--dir');
const base = dirFlag !== -1 ? path.resolve(args[dirFlag + 1]) : path.join(os.tmpdir(), 'synchrobuilder-demo');
const reset = args.includes('--reset');

function git(cwd, ...a) {
  const r = spawnSync('git', a, { cwd, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, windowsHide: true });
  if (r.status !== 0) throw new Error(`git ${a.join(' ')} failed in ${cwd}: ${r.stderr}`);
  return r.stdout;
}
function cli(cwd, home, ...a) {
  const r = spawnSync(process.execPath, [path.join(plugin, 'bin', 'synchrobuilder.mjs'), ...a], { cwd, encoding: 'utf8', env: { ...process.env, SYNCHROBUILDER_HOME: home }, windowsHide: true });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

if (reset) fs.rmSync(base, { recursive: true, force: true });
if (fs.existsSync(base)) { console.log(`Demo already set up at ${base}. Use --reset to start over.\n`); }
else {
  fs.mkdirSync(base, { recursive: true });
  const origin = path.join(base, 'origin.git');
  git(base, 'init', '-q', '--bare', origin);
  const seed = path.join(base, 'seed');
  fs.cpSync(path.join(repo, 'examples', 'demo-repo'), seed, { recursive: true });
  fs.mkdirSync(path.join(seed, '.synchrobuilder'), { recursive: true });
  fs.writeFileSync(path.join(seed, '.synchrobuilder', 'team.json'), JSON.stringify({ version: 1, members: { alice: { name: 'Alice', emails: ['alice@demo.invalid'] }, bob: { name: 'Bob', emails: ['bob@demo.invalid'] } } }, null, 2) + '\n');
  git(seed, 'init', '-q');
  git(seed, 'config', 'user.name', 'seed');
  git(seed, 'config', 'user.email', 'seed@demo.invalid');
  git(seed, 'add', '-A');
  git(seed, 'commit', '-q', '-m', 'demo repository with planted portability bugs');
  git(seed, 'push', '-q', origin, 'HEAD:main');
  for (const name of ['alice', 'bob']) {
    const clone = path.join(base, name, 'demo-repo');
    const home = path.join(base, name, 'home');
    fs.mkdirSync(home, { recursive: true });
    git(base, 'clone', '-q', origin, clone);
    git(clone, 'config', 'user.name', name[0].toUpperCase() + name.slice(1));
    git(clone, 'config', 'user.email', `${name}@demo.invalid`);
    const r = cli(clone, home, 'iam', name);
    if (r.code !== 0) console.log(`(iam not available yet: ${r.out.trim()})`);
  }
  console.log(`Demo set up at ${base}\n`);
}

const q = (p) => (p.includes(' ') ? `"${p}"` : p);
const envLine = (name) => (process.platform === 'win32'
  ? `$env:SYNCHROBUILDER_HOME = ${q(path.join(base, name, 'home'))}`
  : `export SYNCHROBUILDER_HOME=${q(path.join(base, name, 'home'))}`);

console.log(`Two-terminal walkthrough
========================

Terminal 1 (alice)                                   Terminal 2 (bob)
-------------------------------------------------    -------------------------------------------------
cd ${q(path.join(base, 'alice', 'demo-repo'))}
${envLine('alice')}
claude --plugin-dir ${q(plugin)}
                                                     cd ${q(path.join(base, 'bob', 'demo-repo'))}
                                                     ${envLine('bob')}
                                                     claude --plugin-dir ${q(plugin)}

1. In both: /synchrobuilder:status          -> each sees the other as active (after the first sync, up to a minute).
2. Alice:   /synchrobuilder:audit           -> the demo repo scores low; every planted bug is listed with a fix.
3. Alice:   /synchrobuilder:claim src/index.js
4. Bob:     ask Claude to edit src/index.js -> Claude is warned that alice claimed it (advisory; nothing is blocked).
5. Bob:     /synchrobuilder:notify alice please run the audit fix first
6. Alice:   send any prompt                 -> the message arrives as labelled teammate data; a one-line notice is shown.
7. Alice:   /synchrobuilder:fix             -> review the diffs, approve, watch the score rise.
8. Alice:   /exit                           -> a handoff is staged from the session's events and published.
9. Bob:     start a new session             -> the session digest lists alice's handoff.

Portability on three OSes: /synchrobuilder:ci writes a GitHub Actions workflow for the demo repo; push it to a
repository of your own to see it run on ubuntu, macos and windows.

Everything above stays on this machine: the "remote" is ${q(path.join(base, 'origin.git'))}, and each developer's
state lives under their own SYNCHROBUILDER_HOME. Remove it all with: node scripts/demo.mjs --reset
`);
