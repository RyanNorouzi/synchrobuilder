// install: register Synchrobuilder with Claude Code in one command, the way a person expects after copying a line
// off a website. It changes the machine's Claude Code configuration, so it prints the exact plan first and does
// nothing without consent (--yes, or answering the prompt).
//
//   npx synchrobuilder@latest install
//   npx synchrobuilder@latest install --scope project --yes
//   npx synchrobuilder@latest install --uninstall
import readline from 'node:readline';
import { run as runProgram } from '../core/proc.mjs';
import { MARKETPLACE, PLUGIN_NAME, marketplaceSource } from '../core/release.mjs';

const SCOPES = ['user', 'project', 'local'];

function claudeVersion() {
  const r = runProgram('claude', ['--version'], { timeoutMs: 15000 });
  if (r.code !== 0) return null;
  const m = String(r.stdout || '').match(/(\d+\.\d+\.\d+)/);
  return m ? m[1] : String(r.stdout || '').trim().slice(0, 40);
}

function marketplaceAlreadyAdded() {
  const r = runProgram('claude', ['plugin', 'marketplace', 'list'], { timeoutMs: 30000 });
  return r.code === 0 && new RegExp(`\\b${MARKETPLACE}\\b`).test(r.stdout || '');
}

function pluginAlreadyInstalled() {
  const r = runProgram('claude', ['plugin', 'list'], { timeoutMs: 30000 });
  return r.code === 0 && new RegExp(`${PLUGIN_NAME}@${MARKETPLACE}`).test(r.stdout || '');
}

function ask(question, stdin, stdout) {
  return new Promise((resolve) => {
    if (!stdin.isTTY) { resolve(false); return; }
    const rl = readline.createInterface({ input: stdin, output: stdout });
    rl.question(question, (answer) => { rl.close(); resolve(/^y(es)?$/i.test(String(answer).trim())); });
  });
}

function describe(steps) {
  return steps.map((s, i) => `  ${i + 1}. ${s.title}\n     runs: claude ${s.args.join(' ')}`).join('\n');
}

export async function run({ flags = {}, cwd = process.cwd(), stdout = process.stdout, stderr = process.stderr, stdin = process.stdin } = {}) {
  const scope = SCOPES.includes(flags.scope) ? flags.scope : 'user';
  const uninstalling = Boolean(flags.uninstall);

  const version = claudeVersion();
  if (!version) {
    stderr.write([
      'Claude Code was not found on this machine (the "claude" command is not on PATH).',
      '',
      'Install it first: https://code.claude.com/docs/en/quickstart',
      'Then run this command again.',
      '',
      'Synchrobuilder is a Claude Code plugin; the portability commands also work on their own:',
      '  npx synchrobuilder audit',
      '',
    ].join('\n'));
    return 1;
  }

  const steps = uninstalling
    ? [{ title: `Remove the ${PLUGIN_NAME} plugin`, args: ['plugin', 'uninstall', `${PLUGIN_NAME}@${MARKETPLACE}`] },
       { title: `Remove the ${MARKETPLACE} marketplace`, args: ['plugin', 'marketplace', 'remove', MARKETPLACE] }]
    : [{ title: `Add the ${MARKETPLACE} marketplace (${marketplaceSource()})`, args: ['plugin', 'marketplace', 'add', marketplaceSource()], skip: marketplaceAlreadyAdded, skipNote: 'already added' },
       { title: `Install the ${PLUGIN_NAME} plugin at ${scope} scope`, args: ['plugin', 'install', `${PLUGIN_NAME}@${MARKETPLACE}`, '--scope', scope], skip: pluginAlreadyInstalled, skipNote: 'already installed' }];

  stdout.write(`Synchrobuilder ${uninstalling ? 'uninstall' : 'install'}\n\n`);
  stdout.write(`Claude Code ${version} found.\n\n`);
  stdout.write(`This changes your Claude Code configuration:\n${describe(steps)}\n\n`);
  if (!uninstalling) {
    stdout.write(`It writes to your Claude Code settings and plugin cache. Nothing else on the machine is touched,\nand "npx synchrobuilder install --uninstall" reverses it.\n\n`);
  }
  if (flags.plan) return 0;

  if (!flags.yes) {
    const ok = await ask('Proceed? [y/N] ', stdin, stdout);
    if (!ok) {
      stdout.write(stdin.isTTY ? 'Nothing was changed.\n' : 'Nothing was changed: this is not an interactive terminal, so re-run with --yes to proceed.\n');
      return 1;
    }
    stdout.write('\n');
  }

  for (const step of steps) {
    if (step.skip && step.skip()) { stdout.write(`- ${step.title}: ${step.skipNote}\n`); continue; }
    stdout.write(`- ${step.title}...`);
    const r = runProgram('claude', step.args, { cwd, timeoutMs: 180000 });
    if (r.code !== 0) {
      stdout.write(' failed\n\n');
      stderr.write(`${(r.stderr || r.stdout || 'no output').trim()}\n\n`);
      stderr.write(`The command that failed was:\n  claude ${step.args.join(' ')}\n`);
      if (/not found|could not resolve|repository/i.test(`${r.stderr}${r.stdout}`)) {
        stderr.write('\nIf the repository is private, make sure your git credentials can read it.\n');
      }
      return 1;
    }
    stdout.write(' done\n');
  }

  if (uninstalling) {
    stdout.write('\nRemoved. Your projects are untouched; "npx synchrobuilder clean" also removes the local state directory.\n');
    return 0;
  }
  stdout.write([
    '',
    'Installed. Start Claude Code in a project and try:',
    '',
    '  /synchrobuilder:audit        find OS-specific assumptions in this project',
    '  /synchrobuilder:init         write synchrobuilder.json so teammates can set it up',
    '  /synchrobuilder:status       who else on your team is working here',
    '',
    'A running session picks the plugin up at its next start, or run /reload-plugins now.',
    '',
  ].join('\n'));
  return 0;
}
