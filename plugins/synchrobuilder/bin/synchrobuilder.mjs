#!/usr/bin/env node
// `npx synchrobuilder <command>`: the same code the plugin's skills run, usable outside Claude Code and in CI.
import { parseArgs } from '../lib/core/args.mjs';
import { pluginVersion } from '../lib/core/version.mjs';

const COMMANDS = {
  audit: { module: 'audit.mjs', summary: 'Scan the project for OS-specific assumptions', usage: 'audit [path] [--json] [--strict] [--only rule-ids] [--report file]' },
  fix: { module: 'fix.mjs', summary: 'Propose and apply fixes for audit findings', usage: 'fix [path] [--dry-run] [--yes] [--only rule-ids-or-paths] [--json]' },
  mute: { module: 'mute.mjs', summary: 'Silence the guard hook for this checkout', usage: 'mute [on|off|status]' },
  init: { module: 'init.mjs', summary: 'Write synchrobuilder.json for this project', usage: 'init [path] [--refresh] [--team [--yes]] [--json]' },
  setup: { module: 'setup.mjs', summary: 'Set this machine up from synchrobuilder.json', usage: 'setup [path] [--plan] [--yes] [--json]' },
  doctor: { module: 'doctor.mjs', summary: 'Explain why this machine differs from the manifest', usage: 'doctor [path] [--record] [--json]' },
  ci: { module: 'ci.mjs', summary: 'Generate a three-OS GitHub Actions workflow', usage: 'ci [path] [--write] [--json]' },
  iam: { module: 'iam.mjs', summary: 'Show or set your handle for this checkout', usage: 'iam [handle] [--json]' },
  status: { module: 'status.mjs', summary: 'Who is active and what the sync transport is doing', usage: 'status [--json]' },
  claim: { module: 'claim.mjs', summary: 'Claim a path or task', usage: 'claim <path or task-id> [--note text]' },
  release: { module: 'release.mjs', summary: 'Release a claim', usage: 'release [path or task-id]' },
  notify: { module: 'notify.mjs', summary: 'Message a teammate', usage: 'notify <handle> <message...>' },
  board: { module: 'board.mjs', summary: 'Shared task board', usage: 'board [list | add <title> [--deps a,b] | take <id> [--force] | done <id> | next]' },
  handoff: { module: 'handoff.mjs', summary: 'Write a handoff note', usage: 'handoff [handle] [--draft] | --confirm <draft id> [--done "a; b"] [--next ...] [--for a,b]' },
  statusline: { module: 'statusline.mjs', summary: 'Install or remove the status line', usage: 'statusline [install|remove] [--plan] [--yes]' },
  clean: { module: 'clean.mjs', summary: 'Remove ~/.synchrobuilder', usage: 'clean [--yes]' },
  worker: { module: 'worker.mjs', summary: 'Run the background sync worker (started for you by the session hook)', usage: 'worker [checkoutDir remoteDir] [--once] [--json]', internal: true },
};

function usage() {
  const lines = ['synchrobuilder ' + pluginVersion(), '', 'Usage: synchrobuilder <command> [options]', ''];
  for (const [name, c] of Object.entries(COMMANDS)) if (!c.internal) lines.push(`  ${name.padEnd(12)} ${c.summary}`);
  lines.push('', 'Run "synchrobuilder <command> --help" for one command, or --version for the version.');
  lines.push('Inside Claude Code the same commands are /synchrobuilder:<name>.');
  return lines.join('\n');
}

function commandHelp(name, spec) {
  return [`synchrobuilder ${spec.usage}`, '', `  ${spec.summary}.`, '', `Inside Claude Code: /synchrobuilder:${name}`].join('\n');
}

async function main() {
  const { flags, positionals } = parseArgs(process.argv.slice(2), { booleans: ['json', 'strict', 'yes', 'dry-run', 'help', 'version', 'refresh', 'quiet'] });
  if (flags.version) { process.stdout.write(pluginVersion() + '\n'); return 0; }
  const name = positionals[0];
  if (!name || flags.help && !name) { process.stdout.write(usage() + '\n'); return name ? 0 : 1; }
  const spec = COMMANDS[name];
  if (!spec) { process.stderr.write(`Unknown command "${name}".\n\n${usage()}\n`); return 1; }
  if (flags.help) { process.stdout.write(commandHelp(name, spec) + '\n'); return 0; }
  let mod;
  try {
    mod = await import(`../lib/cli/${spec.module}`);
  } catch (err) {
    if (err && err.code === 'ERR_MODULE_NOT_FOUND') { process.stderr.write(`"${name}" is planned for phase ${spec.phase} and is not implemented yet.\n`); return 2; }
    throw err;
  }
  const code = await mod.run({ flags, args: positionals.slice(1), cwd: process.cwd(), stdout: process.stdout, stderr: process.stderr });
  return Number.isInteger(code) ? code : 0;
}

main().then((code) => { process.exitCode = code; }).catch((err) => { process.stderr.write(`synchrobuilder: ${err && err.stack ? err.stack : err}\n`); process.exitCode = 1; });
